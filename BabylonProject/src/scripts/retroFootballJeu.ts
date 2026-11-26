/**
 * RetroFootball — le jeu (1 joueur contre l'IA).
 *
 * À attacher sur un nœud de la scène (par ex. `Ballon`, à la place de la cinématique — si les deux sont
 * attachés, la cinématique se met en veille toute seule). Enchaîne : menu principal → choix d'équipe →
 * intro (la cinématique du but) → match → pause / fin.
 */
import { Camera, FreeCamera, Node, Scene, TransformNode, Vector3 } from "@babylonjs/core";

import { IScript, visibleAsBoolean, visibleAsNumber } from "babylonjs-editor-tools";

import { AudioJeu } from "../jeu/audio";
import { EffetsStade } from "../jeu/fx";
import { Clavier, Match } from "../jeu/match";
import { InterfaceRetro, type Equipe, type Options } from "../jeu/ui";
import { FOV_CAMERA } from "./retroFootballCinematique";

type EtatJeu = "menu" | "intro" | "match" | "pause" | "fin";

const DUREE_INTRO = 13;

export default class RetroFootballJeu implements IScript {
	@visibleAsNumber("Durée du match (minutes réelles)", { min: 1, max: 10, step: 1 })
	public duree: number = 3;

	@visibleAsNumber("Difficulté (0 facile, 1 normal, 2 difficile)", { min: 0, max: 2, step: 1 })
	public difficulte: number = 1;

	@visibleAsNumber("Volume (0-10)", { min: 0, max: 10, step: 1 })
	public volume: number = 8;

	@visibleAsBoolean("Intro avant le match")
	public intro: boolean = true;

	@visibleAsNumber("Quantité de particules (x)", { min: 0, max: 2, step: 0.05 })
	public qualite: number = 0.6;

	private _scene!: Scene;
	private _etat: EtatJeu = "menu";
	private _audio = new AudioJeu();
	private _clavier!: Clavier;
	private _ui!: InterfaceRetro;
	private _fx!: EffetsStade;
	private _match: Match | null = null;
	private _cameraJeu!: FreeCamera;
	private _cameraIntro: Camera | null = null;
	private _options!: Options;
	private _equipe: Equipe = "rouge";
	private _introT = 0;
	private _introEvenements = new Set<string>();
	private _geste = () => this._audio.activer();
	private _arrete = false;

	public constructor(public object: Node) {
		// Signale à la cinématique qu'elle doit rester en veille.
		(globalThis as any).__retroFootballJeu = true;
	}

	public onStart(): void {
		this._scene = this.object.getScene();
		const scene = this._scene;
		scene.animationGroups.forEach((g) => {
			g.stop();
			g.start(false, 1, g.from, g.to);
			g.goToFrame(g.from);
			g.pause();
		});

		// L'éditeur importe le GLB à l'échelle 100 (scènes en centimètres) : on travaille en mètres dans
		// l'espace du GLB et on adapte les distances exprimées dans l'espace monde.
		const racine = (scene.getNodeByName("Ballon") as TransformNode | null)?.parent as TransformNode | null;
		racine?.computeWorldMatrix(true);
		const m = racine?.getWorldMatrix().m;
		const echelle = m ? Math.hypot(m[0], m[1], m[2]) || 1 : 1;

		this._cameraIntro = scene.getCameraByName("Camera_Principale");
		this._cameraJeu = new FreeCamera("CameraJeu", new Vector3(0, 20, 30), scene);
		this._cameraJeu.minZ = 0.2 * echelle;
		this._cameraJeu.maxZ = 700 * echelle;
		this._cameraJeu.fov = 0.62;
		if (this._cameraIntro) {
			this._cameraIntro.minZ = 0.1 * echelle;
			this._cameraIntro.maxZ = 700 * echelle;
			scene.activeCamera = this._cameraIntro;
		}

		this._fx = new EffetsStade(scene, this.qualite, echelle);
		this._fx.installer([this._cameraJeu, ...(this._cameraIntro ? [this._cameraIntro] : [])]);

		this._options = { duree: this.duree, difficulte: this.difficulte, volume: this.volume, intro: this.intro };
		this._audio.volume = this.volume / 10;
		this._clavier = new Clavier();

		const conteneur = scene.getEngine().getRenderingCanvas()?.parentElement ?? document.body;
		this._ui = new InterfaceRetro(conteneur, this._audio, this._options, {
			jouer: (eq) => this._jouer(eq),
			options: (o) => {
				this._options = o;
				this._audio.volume = o.volume / 10;
			},
			reprendre: () => {
				this._etat = "match";
				this._clavier.vider();
			},
			quitterMatch: () => this._retourMenu(),
			rejouer: () => this._lancerMatch(),
			passerIntro: () => this._finIntro(),
		});
		this._ui.afficherMenu();

		// Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur.
		window.addEventListener("pointerdown", this._geste);
		window.addEventListener("keydown", this._geste);
		scene.onDisposeObservable.addOnce(() => this.onStop());
		// accès de débogage depuis la console du navigateur : window.__retroFootball
		(globalThis as any).__retroFootball = this;
	}

	public onUpdate(): void {
		const dt = Math.min(0.1, this._scene.getEngine().getDeltaTime() / 1000);
		this._fx.maj(dt);

		switch (this._etat) {
			case "intro":
				this._majIntro(dt);
				break;
			case "match":
				if (this._clavier.appui("Escape", "KeyP")) {
					this._etat = "pause";
					this._ui.afficherPause();
					this._audio.retour();
					break;
				}
				this._match?.maj(dt, this._clavier);
				if (this._match?.termine) {
					this._etat = "fin";
				}
				break;
		}
		this._clavier.finImage();
	}

	public onStop(): void {
		if (this._arrete) {
			return;
		}
		this._arrete = true;
		window.removeEventListener("pointerdown", this._geste);
		window.removeEventListener("keydown", this._geste);
		this._match?.detruire();
		this._ui?.detruire();
		this._clavier?.detruire();
		this._audio.fermer();
		(globalThis as any).__retroFootballJeu = false;
	}

	// ------------------------------------------------------------------ enchaînement

	private _jouer(equipe: Equipe): void {
		this._equipe = equipe;
		if (this._options.intro && this._cameraIntro && this._scene.animationGroups.length) {
			this._lancerIntro();
		} else {
			this._lancerMatch();
		}
	}

	private _lancerIntro(): void {
		this._etat = "intro";
		this._introT = 0;
		this._introEvenements.clear();
		this._ui.afficherIntro();
		this._fx.calmer();
		this._scene.activeCamera = this._cameraIntro;
		this._scene.animationGroups.forEach((g) => {
			g.stop();
			g.start(false, 1, g.from, g.to);
		});
		this._audio.demarrerFoule();
	}

	private _majIntro(dt: number): void {
		this._introT += dt;
		const frame = 1 + this._introT * 30;
		// zoom de la caméra (même courbe que dans Blender)
		if (this._cameraIntro) {
			const i = Math.max(0, (frame - 1) / 5);
			const a = Math.min(FOV_CAMERA.length - 1, Math.floor(i));
			const b = Math.min(FOV_CAMERA.length - 1, a + 1);
			this._cameraIntro.fov = FOV_CAMERA[a] + (FOV_CAMERA[b] - FOV_CAMERA[a]) * (i - a);
		}
		const une = (cle: string, f: number, action: () => void) => {
			if (frame >= f && !this._introEvenements.has(cle)) {
				this._introEvenements.add(cle);
				action();
			}
		};
		une("frappe", 60, () => this._audio.frappe(0.9));
		une("but", 78, () => {
			this._audio.clameur();
			this._audio.jingle();
			this._fx.celebrer("rouge", 7);
			this._fx.prochainsFeux.forEach((t) => this._audio.feuArtifice(Math.max(0, t - 0.5)));
		});
		une("filet", 79, () => this._audio.filet());
		une("sifflet", 96, () => this._audio.sifflet(2));
		if (this._introT >= DUREE_INTRO) {
			this._finIntro();
		}
	}

	private _finIntro(): void {
		if (this._etat !== "intro") {
			return;
		}
		this._ui.finIntro();
		this._lancerMatch();
	}

	private _lancerMatch(): void {
		this._match?.detruire();
		this._scene.animationGroups.forEach((g) => g.stop());
		this._fx.calmer();
		this._scene.activeCamera = this._cameraJeu;
		this._match = new Match(this._scene, this._cameraJeu, this._fx, this._audio, this._ui, {
			equipe: this._equipe,
			difficulte: this._options.difficulte,
			duree: this._options.duree,
		});
		this._match.demarrer();
		this._etat = "match";
	}

	private _retourMenu(): void {
		this._match?.detruire();
		this._match = null;
		this._audio.arreterFoule();
		this._fx.calmer();
		this._ui.masquerHud();
		this._ui.afficherMenu();
		this._etat = "menu";
	}
}
