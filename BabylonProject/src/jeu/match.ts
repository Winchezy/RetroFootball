/**
 * Simulation d'un match 6 contre 6 : ballon, joueurs, contrôles clavier, IA, gardiens, sorties, buts,
 * célébrations et caméra TV. Tout est calculé dans l'espace glTF du stade (enfants du nœud racine du GLB) :
 * x = longueur du terrain (buts en x = ±52,5), z = largeur (lignes de touche en z = ±34), y = hauteur.
 * Les Rouges attaquent vers +x, les Bleus vers -x.
 */
import { Color3, FreeCamera, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";

import type { AudioJeu } from "./audio";
import type { EffetsStade } from "./fx";
import {
	RigJoueur,
	capDepuis,
	clamp,
	diffAngle,
	dirDepuis,
	lerp,
	melange,
	poseAvion,
	poseCourse,
	poseFrappe,
	poseGardienBallon,
	poseGardienPret,
	poseGenoux,
	poseMainsTete,
	posePlongeon,
	posePoing,
	poseSautJoie,
	poseTacle,
	poseTeteBasse,
	ss,
} from "./rig";
import { STATS, type Aide, type Equipe, type InterfaceRetro } from "./ui";

const L = 52.5;
const W = 34;
const BUT_Z = 3.66;
const BUT_H = 2.44;
const R = 0.22;
const G = 9.81;
const PAS = 1 / 60;
/** Distance (m) à partir de laquelle le joueur le plus proche attire le ballon devant ses pieds. */
const RAYON_AIMANT = 2.6;
/** Durée (s) du glissement du ballon jusqu'aux pieds au moment de la prise. */
const PRISE_DUREE = 0.14;

const sens = (e: Equipe) => (e === "rouge" ? 1 : -1);
const autre = (e: Equipe): Equipe => (e === "rouge" ? "bleu" : "rouge");
const hasard = (a: number, b: number) => a + Math.random() * (b - a);

type Poste = "G" | "D1" | "D2" | "M1" | "M2" | "A";
/** Positions de base pour une équipe qui attaque vers +x. */
const FORMATION: Record<Poste, [number, number]> = {
	G: [-50.5, 0],
	D1: [-33, -11],
	D2: [-33, 11],
	M1: [-16, -14],
	M2: [-16, 14],
	A: [-4, 0],
};
const LIMITES: Record<Poste, [number, number]> = { G: [-51, -45], D1: [-47, 8], D2: [-47, 8], M1: [-40, 30], M2: [-40, 30], A: [-25, 44] };

const TAGS: Record<Equipe, [string, Poste][]> = {
	rouge: [["Rouge_01", "G"], ["Rouge_04", "D1"], ["Rouge_05", "D2"], ["Rouge_07", "M2"], ["Rouge_10", "M1"], ["Rouge_09", "A"]],
	bleu: [["Bleu_01", "G"], ["Bleu_02", "D2"], ["Bleu_03", "D1"], ["Bleu_04", "M2"], ["Bleu_05", "M1"], ["Bleu_08", "A"]],
};

type Action = { type: "frappe" | "tacle" | "plongeon"; t: number; duree: number; cote?: number; vx?: number; vz?: number };
type Fete = "aucune" | "buteur" | "joie" | "triste" | "mainsTete";

type Joueur = {
	tag: string;
	equipe: Equipe;
	poste: Poste;
	gardien: boolean;
	rig: RigJoueur;
	x: number;
	z: number;
	vx: number;
	vz: number;
	cap: number;
	phase: number;
	action: Action | null;
	/** ne peut pas toucher le ballon pendant ce temps (s) */
	bloque: number;
	/** au sol après un tacle (s) */
	sonne: number;
	tacleCd: number;
	fete: Fete;
	feteT: number;
	vmax: number;
};

type Etat = "engagement" | "jeu" | "arret" | "but" | "fin";

/** État du clavier avec détection des appuis. */
export class Clavier {
	private _bas = new Set<string>();
	private _appuis = new Set<string>();
	private _relaches = new Set<string>();
	private _down = (e: KeyboardEvent) => {
		if (e.defaultPrevented) {
			return; // déjà traité par un menu
		}
		if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(e.code)) {
			e.preventDefault();
		}
		if (!this._bas.has(e.code)) {
			this._appuis.add(e.code);
		}
		this._bas.add(e.code);
	};
	private _up = (e: KeyboardEvent) => {
		this._bas.delete(e.code);
		this._relaches.add(e.code);
	};
	private _blur = () => this._bas.clear();

	public constructor() {
		window.addEventListener("keydown", this._down);
		window.addEventListener("keyup", this._up);
		window.addEventListener("blur", this._blur);
	}

	public bas(...codes: string[]): boolean {
		return codes.some((c) => this._bas.has(c));
	}

	public appui(...codes: string[]): boolean {
		return codes.some((c) => this._appuis.has(c));
	}

	public relache(...codes: string[]): boolean {
		return codes.some((c) => this._relaches.has(c));
	}

	/** Oublie tous les appuis en attente (après la fermeture d'un menu). */
	public vider(): void {
		this._appuis.clear();
		this._relaches.clear();
	}

	/** À appeler à la fin de chaque image. */
	public finImage(): void {
		this._appuis.clear();
		this._relaches.clear();
	}

	public detruire(): void {
		window.removeEventListener("keydown", this._down);
		window.removeEventListener("keyup", this._up);
		window.removeEventListener("blur", this._blur);
	}
}

export type ParametresMatch = { equipe: Equipe; difficulte: number; duree: number };

export class Match {
	public readonly camera: FreeCamera;
	public scoreRouge = 0;
	public scoreBleu = 0;
	public termine = false;

	private readonly _scene: Scene;
	private readonly _fx: EffetsStade;
	private readonly _audio: AudioJeu;
	private readonly _ui: InterfaceRetro;
	private readonly _p: ParametresMatch;
	private readonly _racine: TransformNode;
	private readonly _ballonNode: TransformNode;
	private readonly _joueurs: Joueur[] = [];

	// ballon
	private _b = new Vector3(0, R, 0);
	private _bv = new Vector3();
	private _porteur: Joueur | null = null;
	private _dernier: Joueur | null = null;
	private _tirId = 0;
	private _tirEquipe: Equipe | null = null;
	private _gardienDecide = -1;
	private _arretReussi = false;
	private _ballonRot = Quaternion.Identity();
	private _priseT = 0;
	private _priseDepart = new Vector3();
	private _dansFilet = false;

	// déroulement
	private _etat: Etat = "engagement";
	private _etatT = 0;
	private _tempsJeu = 0;
	private _engageur: Equipe = "rouge";
	private _buteur: Joueur | null = null;
	private _butEquipe: Equipe = "rouge";
	private _apresArret: (() => void) | null = null;

	// contrôle humain
	private _controle: Joueur | null = null;
	private _charge = -1;
	private _changeT = 0;
	private _decisionIA = new Map<Joueur, number>();

	// caméra / indicateur
	private _camPos = new Vector3(0, 13.5, 31);
	private _camCible = new Vector3(0, 0.5, 0);
	private _orbite = 0;
	private _indicateur: Mesh;
	private _anneau: Mesh;

	public constructor(scene: Scene, camera: FreeCamera, fx: EffetsStade, audio: AudioJeu, ui: InterfaceRetro, p: ParametresMatch) {
		this._scene = scene;
		this._fx = fx;
		this._audio = audio;
		this._ui = ui;
		this._p = p;

		this._ballonNode = scene.getNodeByName("Ballon") as TransformNode;
		this._racine = this._ballonNode.parent as TransformNode;
		if (!this._ballonNode.rotationQuaternion) {
			this._ballonNode.rotationQuaternion = Quaternion.Identity();
		}

		// Les animations de la cinématique ne doivent plus piloter les nœuds.
		scene.animationGroups.forEach((g) => g.stop());

		const facteurIA = [0.9, 1.0, 1.07][p.difficulte];
		(["rouge", "bleu"] as Equipe[]).forEach((eq) => {
			for (const [tag, poste] of TAGS[eq]) {
				const n = scene.getNodeByName(tag) as TransformNode | null;
				if (!n) {
					continue;
				}
				const vit = STATS[eq].vit;
				const vmax = (6.6 + 0.15 * vit) * (eq === p.equipe ? 1 : facteurIA);
				this._joueurs.push({
					tag,
					equipe: eq,
					poste,
					gardien: poste === "G",
					rig: new RigJoueur(n, tag),
					x: 0,
					z: 0,
					vx: 0,
					vz: 0,
					cap: 0,
					phase: Math.random() * 6,
					action: null,
					bloque: 0,
					sonne: 0,
					tacleCd: 0,
					fete: "aucune",
					feteT: 0,
					vmax,
				});
			}
		});

		this.camera = camera;
		this.camera.fov = 0.62;

		// Indicateur du joueur contrôlé : pyramide qui flotte + anneau au sol.
		const mat = new StandardMaterial("MatIndicateur", scene);
		mat.disableLighting = true;
		mat.emissiveColor = new Color3(1, 0.9, 0.2);
		this._indicateur = MeshBuilder.CreateCylinder("Indicateur", { diameterTop: 0.55, diameterBottom: 0, height: 0.45, tessellation: 4 }, scene);
		this._anneau = MeshBuilder.CreateTorus("AnneauIndicateur", { diameter: 1.3, thickness: 0.07, tessellation: 24 }, scene);
		[this._indicateur, this._anneau].forEach((m) => {
			m.material = mat;
			m.parent = this._racine;
			m.isPickable = false;
		});
	}

	public detruire(): void {
		this._indicateur.dispose();
		this._anneau.dispose();
	}

	public get equipeHumaine(): Equipe {
		return this._p.equipe;
	}

	private get _minute(): number {
		return (this._tempsJeu / (this._p.duree * 60)) * 90;
	}

	// ------------------------------------------------------------------ démarrage / engagement

	public demarrer(): void {
		this.scoreRouge = 0;
		this.scoreBleu = 0;
		this._tempsJeu = 0;
		this.termine = false;
		this._engageur = this._p.equipe;
		this._ui.afficherHud(this._p.equipe);
		this._engagement();
		this._audio.demarrerFoule();
	}

	private _engagement(): void {
		this._etat = "engagement";
		this._etatT = 0;
		this._fx.calmer();
		this._dansFilet = false;
		this._tirEquipe = null;
		for (const j of this._joueurs) {
			const s = sens(j.equipe);
			let [u, z] = FORMATION[j.poste];
			if (j.poste === "A" && j.equipe === this._engageur) {
				u = -0.6;
				z = 0;
			}
			if (j.poste.startsWith("M") && j.equipe === this._engageur) {
				u = -3;
			}
			if (j.poste === "A" && j.equipe !== this._engageur) {
				u = -10; // hors du rond central
			}
			j.x = u * s;
			j.z = z * (j.equipe === "rouge" ? 1 : -1);
			j.vx = j.vz = 0;
			j.cap = j.equipe === "rouge" ? 0 : Math.PI;
			j.action = null;
			j.bloque = j.sonne = 0;
			j.fete = "aucune";
		}
		this._b.set(0, R, 0);
		this._bv.set(0, 0, 0);
		const engageur = this._joueurs.find((j) => j.equipe === this._engageur && j.poste === "A") ?? null;
		this._porteur = engageur;
		this._dernier = engageur;
		this._controle = this._joueurs.find((j) => j.equipe === this._p.equipe && j.poste === "A") ?? null;
		this._ui.message(this._tempsJeu === 0 ? "COUP D'ENVOI" : "ENGAGEMENT", 1.4);
	}

	// ------------------------------------------------------------------ boucle

	public maj(dt: number, c: Clavier): void {
		dt = Math.min(dt, 0.1);
		this._etatT += dt;
		this._majAxesEcran();
		let reste = dt;
		while (reste > 1e-6) {
			const h = Math.min(PAS, reste);
			this._pas(h, c);
			reste -= h;
		}
		this._rendre(dt);
		this._ui.majHud(this.scoreRouge, this.scoreBleu, this._minute, this._charge >= 0 ? this._puissance() : null);
		this._ui.majAides(this._aides());
	}

	/** Touches proposées selon la situation du joueur contrôlé. */
	private _aides(): Aide[] {
		const j = this._controle;
		if (!j || (this._etat !== "jeu" && this._etat !== "engagement")) {
			return [];
		}
		const sprint: Aide = { touches: ["MAJ"], texte: "SPRINT", discret: true };
		if (this._charge >= 0) {
			return [
				{ touches: ["X"], texte: "RELACHE POUR TIRER", chaud: true },
				{ touches: ["▲", "▼"], texte: "VISER" },
			];
		}
		const adversaires = this._joueurs.filter((o) => o.equipe !== j.equipe && !o.gardien);
		if (this._porteur === j) {
			const dBut = Math.hypot(L * sens(j.equipe) - j.x, j.z);
			const presse = adversaires.some((o) => Math.hypot(o.x - j.x, o.z - j.z) < 3.5);
			const tirable = dBut < 26 && Math.abs(j.z) < 20;
			return [
				{ touches: ["ESPACE"], texte: "PASSE", chaud: presse && !tirable },
				{ touches: ["X"], texte: tirable ? "TIRE !" : "TIR (MAINTENIR)", chaud: tirable },
				sprint,
			];
		}
		const porteur = this._porteur;
		if (porteur && porteur.equipe !== j.equipe) {
			const d = Math.hypot(porteur.x - j.x, porteur.z - j.z);
			const loin = this._joueurs.some((m) => m.equipe === j.equipe && m !== j && !m.gardien && Math.hypot(porteur.x - m.x, porteur.z - m.z) + 6 < d);
			return [
				{ touches: ["C"], texte: j.tacleCd > 0 ? "TACLE..." : "TACLE", chaud: d < 3 && j.tacleCd <= 0 },
				{ touches: ["V"], texte: "CHANGER DE JOUEUR", chaud: loin },
				sprint,
			];
		}
		// ballon libre ou chez un coéquipier
		const libre = !porteur;
		return [
			{ touches: ["ZQSD"], texte: libre ? "VA AU BALLON" : "DEMARQUE-TOI" },
			{ touches: ["V"], texte: "CHANGER DE JOUEUR" },
			sprint,
		];
	}

	private _puissance(): number {
		return clamp(this._charge / 0.9);
	}

	private _pas(h: number, c: Clavier): void {
		switch (this._etat) {
			case "engagement":
				if (this._etatT > 1.4) {
					this._audio.sifflet(1);
					this._etat = "jeu";
					this._etatT = 0;
				}
				this._majJoueurs(h, null, false);
				return;
			case "arret":
				this._majJoueurs(h, null, false);
				if (this._etatT > 0.9) {
					this._etat = "jeu";
					this._etatT = 0;
					this._apresArret?.();
					this._apresArret = null;
				}
				return;
			case "but":
				this._majFete(h);
				this._majBallon(h);
				if (this._etatT > 6.5) {
					this._engageur = autre(this._butEquipe);
					this._engagement();
				}
				return;
			case "fin":
				this._majFete(h);
				return;
		}

		// --- jeu ---
		this._tempsJeu += h;
		if (this._minute >= 90) {
			this._finMatch();
			return;
		}
		this._majControle(h, c);
		this._majJoueurs(h, c, true);
		this._majBallon(h);
		this._majGardiens(h);
		this._prises();
		this._regles();
	}

	// ------------------------------------------------------------------ contrôle humain

	private _entree(c: Clavier): [number, number] {
		let ix = 0;
		let iy = 0;
		if (c.bas("ArrowLeft", "KeyA")) ix -= 1;
		if (c.bas("ArrowRight", "KeyD")) ix += 1;
		if (c.bas("ArrowUp", "KeyW")) iy += 1;
		if (c.bas("ArrowDown", "KeyS")) iy -= 1;
		if (!ix && !iy) {
			return [0, 0];
		}
		// écran -> terrain, d'après l'orientation réelle de la caméra (indépendant du repère de la scène)
		const [rx, rz] = this._axeDroite;
		const [fx, fz] = this._axeAvant;
		const x = ix * rx + iy * fx;
		const z = ix * rz + iy * fz;
		const n = Math.hypot(x, z) || 1;
		return [x / n, z / n];
	}

	private _axeDroite: [number, number] = [1, 0];
	private _axeAvant: [number, number] = [0, -1];

	/** Directions « droite » et « haut » de l'écran projetées sur le terrain (espace du GLB). */
	private _majAxesEcran(): void {
		const inv = this._racine.getWorldMatrix().clone().invert();
		const proj = (v: Vector3): [number, number] => {
			const l = Vector3.TransformNormal(v, inv);
			const n = Math.hypot(l.x, l.z) || 1;
			return [l.x / n, l.z / n];
		};
		this._axeDroite = proj(this.camera.getDirection(Vector3.Right()));
		this._axeAvant = proj(this.camera.getDirection(Vector3.Forward()));
	}

	private _majControle(h: number, c: Clavier): void {
		const equipe = this._p.equipe;
		const moi = this._joueurs.filter((j) => j.equipe === equipe && !j.gardien);
		// le porteur de notre équipe est toujours contrôlé
		if (this._porteur && this._porteur.equipe === equipe && !this._porteur.gardien) {
			this._controle = this._porteur;
		} else {
			this._changeT += h;
			const proche = this._plusProche(moi, this._b.x, this._b.z);
			const ctrl = this._controle;
			const dCtrl = ctrl ? Math.hypot(ctrl.x - this._b.x, ctrl.z - this._b.z) : 1e9;
			const dProche = proche ? Math.hypot(proche.x - this._b.x, proche.z - this._b.z) : 1e9;
			const ballonVersNous = !this._porteur || this._porteur.equipe !== equipe;
			if (proche && proche !== ctrl && ballonVersNous && dProche + 4 < dCtrl && this._changeT > 0.5) {
				this._controle = proche;
				this._changeT = 0;
			}
		}
		if (c.appui("KeyV", "KeyU")) {
			const tri = moi.filter((j) => j !== this._controle).sort((a, b) => Math.hypot(a.x - this._b.x, a.z - this._b.z) - Math.hypot(b.x - this._b.x, b.z - this._b.z));
			if (tri[0]) {
				this._controle = tri[0];
				this._changeT = 0;
				this._audio.bip();
			}
		}

		const j = this._controle;
		if (!j || j.sonne > 0) {
			this._charge = -1;
			return;
		}
		const [dx, dz] = this._entree(c);
		const aBallon = this._porteur === j;

		// Passe
		if (c.appui("Space", "KeyJ") && aBallon) {
			this._passe(j, dx || dz ? [dx, dz] : dirDepuis(j.cap));
		}
		// Tir chargé
		if (c.appui("KeyX", "KeyK")) {
			this._charge = 0;
		}
		if (this._charge >= 0) {
			this._charge += h;
			if (c.relache("KeyX", "KeyK") || this._charge > 1.1) {
				if (this._porteur === j) {
					const vise = dz !== 0 ? clamp(dz * 2.9, -2.9, 2.9) : null;
					this._tir(j, this._puissance(), vise);
				}
				this._charge = -1;
			}
		}
		// Tacle glissé
		if (c.appui("KeyC", "KeyL") && !aBallon && j.tacleCd <= 0 && !j.action) {
			this._tacle(j, dx || dz ? capDepuis(dx, dz) : j.cap);
		}
	}

	// ------------------------------------------------------------------ actions

	private _frapper(j: Joueur, vitesse: Vector3): void {
		this._porteur = null;
		this._dernier = j;
		this._bv.copyFrom(vitesse);
		this._b.y = Math.max(this._b.y, R + 0.02);
		j.bloque = 0.3;
		j.action = { type: "frappe", t: 0, duree: 0.35 };
		this._audio.frappe(clamp(vitesse.length() / 32));
	}

	private _passe(j: Joueur, dir: [number, number]): void {
		let meilleur: Joueur | null = null;
		let score = -1e9;
		for (const m of this._joueurs) {
			if (m === j || m.equipe !== j.equipe || (m.gardien && !j.gardien)) {
				continue;
			}
			const vx = m.x - j.x;
			const vz = m.z - j.z;
			const d = Math.hypot(vx, vz);
			if (d < 4 || d > 42) {
				continue;
			}
			const cos = (vx * dir[0] + vz * dir[1]) / d;
			if (cos < 0.4) {
				continue;
			}
			const risque = this._risqueLigne(j, m) ? 1.2 : 0;
			const avance = ((m.x - j.x) * sens(j.equipe)) / 40;
			const s = cos * 2 - d / 45 - risque + avance * 0.6;
			if (s > score) {
				score = s;
				meilleur = m;
			}
		}
		let tx: number;
		let tz: number;
		let d: number;
		if (meilleur) {
			d = Math.hypot(meilleur.x - j.x, meilleur.z - j.z);
			const v0 = clamp(8 + d * 0.75, 11, 24);
			const t = (d / v0) * 0.8;
			tx = meilleur.x + meilleur.vx * t;
			tz = meilleur.z + meilleur.vz * t;
			d = Math.hypot(tx - j.x, tz - j.z);
			if (j.equipe === this._p.equipe && !meilleur.gardien) {
				this._controle = meilleur;
				this._changeT = 0;
			}
		} else {
			tx = j.x + dir[0] * 14;
			tz = j.z + dir[1] * 14;
			d = 14;
		}
		const v = clamp(8 + d * 0.75, 11, 24);
		const ux = (tx - j.x) / (d || 1);
		const uz = (tz - j.z) / (d || 1);
		const vy = d > 22 ? 5.5 : 1.0;
		j.cap = capDepuis(ux, uz);
		this._frapper(j, new Vector3(ux * v, vy, uz * v));
	}

	private _tir(j: Joueur, puissance: number, viseZ: number | null): void {
		const s = sens(j.equipe);
		const butX = L * s;
		const gardien = this._joueurs.find((g) => g.gardien && g.equipe !== j.equipe);
		const z = viseZ ?? (gardien ? -Math.sign(gardien.z || hasard(-1, 1)) * hasard(1.6, 2.9) : hasard(-2.6, 2.6));
		const att = STATS[j.equipe].att;
		const ia = j.equipe !== this._p.equipe || j !== this._controle;
		const precision = ia ? [0.75, 0.85, 0.93][this._p.difficulte] : 1;
		const erreur = (0.05 * (1 - att / 10) + 0.02 + (puissance > 0.92 ? 0.06 : 0)) / precision;
		const dx = butX - j.x;
		const dz = z - j.z;
		const d = Math.hypot(dx, dz);
		const ang = Math.atan2(dz, dx) + hasard(-erreur, erreur);
		const v = 18 + 14 * puissance;
		const T = d / v;
		const yCible = 0.4 + 1.6 * puissance + (puissance > 0.93 ? 1.3 : 0) + hasard(-0.3, 0.3);
		const vy = (yCible - R + 0.5 * G * T * T) / T;
		j.cap = capDepuis(Math.cos(ang), Math.sin(ang));
		this._frapper(j, new Vector3(Math.cos(ang) * v, clamp(vy, 0.5, 14), Math.sin(ang) * v));
		this._tirId++;
		this._tirEquipe = j.equipe;
		this._gardienDecide = -1;
	}

	private _tacle(j: Joueur, cap: number): void {
		const [dx, dz] = dirDepuis(cap);
		j.cap = cap;
		j.action = { type: "tacle", t: 0, duree: 0.7, vx: dx * 9, vz: dz * 9 };
		j.tacleCd = 1.1;
		this._audio.tacle();
	}

	// ------------------------------------------------------------------ joueurs

	private _plusProche(liste: Joueur[], x: number, z: number): Joueur | null {
		let best: Joueur | null = null;
		let bd = 1e9;
		for (const j of liste) {
			const d = Math.hypot(j.x - x, j.z - z);
			if (d < bd && j.sonne <= 0) {
				bd = d;
				best = j;
			}
		}
		return best;
	}

	/** Un adversaire peut-il couper la ligne de passe a -> b ? */
	private _risqueLigne(a: Joueur, b: Joueur): boolean {
		const lx = b.x - a.x;
		const lz = b.z - a.z;
		const l2 = lx * lx + lz * lz;
		for (const o of this._joueurs) {
			if (o.equipe === a.equipe) {
				continue;
			}
			const t = clamp(((o.x - a.x) * lx + (o.z - a.z) * lz) / l2, 0, 1);
			const d = Math.hypot(a.x + lx * t - o.x, a.z + lz * t - o.z);
			if (d < 1.6 && t > 0.1) {
				return true;
			}
		}
		return false;
	}

	private _majJoueurs(h: number, c: Clavier | null, jeu: boolean): void {
		const possession = this._porteur?.equipe ?? null;
		const ballonLibre = !this._porteur;

		// rôles défensifs par équipe : chasseur et couverture
		const roles = new Map<Joueur, "chasse" | "couvre">();
		if (jeu) {
			for (const eq of ["rouge", "bleu"] as Equipe[]) {
				if (possession === eq) {
					continue;
				}
				const champ = this._joueurs.filter((j) => j.equipe === eq && !j.gardien && j !== this._controle);
				const px = this._b.x + this._bv.x * 0.25;
				const pz = this._b.z + this._bv.z * 0.25;
				champ.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
				if (champ[0]) roles.set(champ[0], "chasse");
				if (champ[1] && !ballonLibre) roles.set(champ[1], "couvre");
			}
		}

		for (const j of this._joueurs) {
			j.bloque = Math.max(0, j.bloque - h);
			j.tacleCd = Math.max(0, j.tacleCd - h);
			if (j.sonne > 0) {
				j.sonne -= h;
				j.vx *= 0.9;
				j.vz *= 0.9;
				j.x += j.vx * h;
				j.z += j.vz * h;
				continue;
			}
			if (j.gardien && jeu) {
				continue; // le gardien (déplacement et plongeon) est géré par _majGardiens
			}
			if (j.action) {
				j.action.t += h;
				if (j.action.type === "tacle") {
					const k = 1 - j.action.t / j.action.duree;
					j.x += j.action.vx! * k * h;
					j.z += j.action.vz! * k * h;
					this._contactTacle(j);
				}
				if (j.action.t >= j.action.duree) {
					j.action = null;
				}
				if (j.action && j.action.type !== "frappe") {
					continue;
				}
			}

			let cibleVx = 0;
			let cibleVz = 0;
			const humain = jeu && c && j === this._controle;
			if (humain) {
				const [dx, dz] = this._entree(c);
				const sprint = c.bas("ShiftLeft", "ShiftRight") ? 1.9 : 0;
				const v = (j.vmax + sprint) * (this._porteur === j ? 0.92 : 1);
				cibleVx = dx * v;
				cibleVz = dz * v;
			} else if (jeu && !j.gardien) {
				[cibleVx, cibleVz] = this._ia(j, roles.get(j), h);
			} else if (!j.gardien) {
				// engagement / arrêt de jeu : rejoindre sa position
				const [tx, tz] = this._positionTactique(j);
				[cibleVx, cibleVz] = this._aller(j, tx, tz, j.vmax * 0.6);
			}
			if (j.gardien && this._etat !== "jeu") {
				const [tx, tz] = this._positionTactique(j);
				[cibleVx, cibleVz] = this._aller(j, tx, tz, 4);
			}
			if (j.gardien && this._etat === "jeu") {
				continue; // géré par _majGardiens
			}
			const acc = 22 * h;
			j.vx += clamp(cibleVx - j.vx, -acc, acc);
			j.vz += clamp(cibleVz - j.vz, -acc, acc);
			j.x += j.vx * h;
			j.z += j.vz * h;
			j.x = clamp(j.x, -L - 1.5, L + 1.5);
			j.z = clamp(j.z, -W - 1.5, W + 1.5);
			const vit = Math.hypot(j.vx, j.vz);
			if (vit > 0.4) {
				j.cap += diffAngle(j.cap, capDepuis(j.vx, j.vz)) * clamp(h * 12);
			}
		}

		// séparation entre joueurs
		for (let a = 0; a < this._joueurs.length; a++) {
			for (let b = a + 1; b < this._joueurs.length; b++) {
				const p = this._joueurs[a];
				const q = this._joueurs[b];
				const dx = q.x - p.x;
				const dz = q.z - p.z;
				const d = Math.hypot(dx, dz);
				if (d > 0.001 && d < 0.75) {
					const push = (0.75 - d) / 2;
					p.x -= (dx / d) * push;
					p.z -= (dz / d) * push;
					q.x += (dx / d) * push;
					q.z += (dz / d) * push;
				}
			}
		}
	}

	private _aller(j: Joueur, tx: number, tz: number, vmax: number): [number, number] {
		const dx = tx - j.x;
		const dz = tz - j.z;
		const d = Math.hypot(dx, dz);
		if (d < 0.3) {
			return [0, 0];
		}
		const v = Math.min(vmax, d * 2.2);
		return [(dx / d) * v, (dz / d) * v];
	}

	private _positionTactique(j: Joueur): [number, number] {
		const s = sens(j.equipe);
		const [bu, bz] = FORMATION[j.poste];
		if (this._etat === "engagement") {
			let u = bu;
			let z = bz;
			if (j.poste === "A" && j.equipe === this._engageur) {
				u = -0.6;
				z = 0;
			} else if (j.poste === "A") {
				u = -10;
			}
			return [u * s, z * (j.equipe === "rouge" ? 1 : -1)];
		}
		const ub = this._b.x * s;
		if (j.gardien) {
			const zg = clamp(this._b.z * 0.25, -2.6, 2.6);
			return [(-L + 1.2 + clamp((ub + L) * 0.02, 0, 2.5)) * s, zg];
		}
		const attaque = this._porteur?.equipe === j.equipe || (!this._porteur && this._dernier?.equipe === j.equipe);
		const decalage = clamp(ub * 0.55 + (attaque ? 14 : -2), -16, 36);
		const [mn, mx] = LIMITES[j.poste];
		const u = clamp(bu + decalage, mn, mx);
		const zBase = bz * (j.equipe === "rouge" ? 1 : -1);
		const z = clamp(zBase * 0.85 + this._b.z * (j.poste === "A" ? 0.5 : 0.3), -W + 2, W - 2);
		return [u * s, z];
	}

	/** Décision IA pour un joueur de champ. Renvoie la vitesse voulue. */
	private _ia(j: Joueur, role: "chasse" | "couvre" | undefined, h: number): [number, number] {
		const s = sens(j.equipe);
		const reflexe = j.equipe === this._p.equipe ? 0.35 : [0.6, 0.38, 0.22][this._p.difficulte];

		if (this._porteur === j) {
			// porteur IA
			const t = (this._decisionIA.get(j) ?? 0) - h;
			this._decisionIA.set(j, t);
			const butX = L * s;
			const dBut = Math.hypot(butX - j.x, j.z);
			const pression = this._joueurs.some((o) => o.equipe !== j.equipe && !o.gardien && Math.hypot(o.x - j.x, o.z - j.z) < 3);
			if (t <= 0) {
				this._decisionIA.set(j, reflexe + hasard(0, 0.25));
				if (dBut < 24 && Math.abs(j.z) < 16 && Math.random() < 0.55) {
					this._tir(j, hasard(0.55, 0.9), null);
					return [j.vx, j.vz];
				}
				const coequipierMieux = this._joueurs.some((m) => m.equipe === j.equipe && m !== j && !m.gardien && (m.x - j.x) * s > 8 && !this._risqueLigne(j, m));
				if ((pression && Math.random() < 0.7) || (coequipierMieux && Math.random() < 0.25)) {
					this._passe(j, [s, hasard(-0.4, 0.4)]);
					return [j.vx, j.vz];
				}
			}
			// dribble vers le but en évitant les adversaires
			let dx = butX - j.x;
			let dz = -j.z * 0.6;
			const n = Math.hypot(dx, dz) || 1;
			dx /= n;
			dz /= n;
			for (const o of this._joueurs) {
				if (o.equipe === j.equipe) continue;
				const ox = o.x - j.x;
				const oz = o.z - j.z;
				const d = Math.hypot(ox, oz);
				if (d < 6 && d > 0.01 && ox * s > -1) {
					dz -= (oz / d) * (6 - d) * 0.35;
				}
			}
			const m = Math.hypot(dx, dz) || 1;
			const v = j.vmax * 0.85;
			return [(dx / m) * v, (dz / m) * v];
		}

		if (role === "chasse") {
			const px = this._b.x + this._bv.x * 0.3;
			const pz = this._b.z + this._bv.z * 0.3;
			// tacle si l'adversaire porteur est tout près
			const p = this._porteur;
			if (p && p.equipe !== j.equipe && j.tacleCd <= 0 && Math.hypot(p.x - j.x, p.z - j.z) < 2.2 && Math.random() < h * (1.6 - reflexe)) {
				this._tacle(j, capDepuis(p.x - j.x, p.z - j.z));
			}
			return this._aller(j, px, pz, j.vmax);
		}
		if (role === "couvre") {
			const butX = -L * s;
			const dx = butX - this._b.x;
			const dz = -this._b.z;
			const d = Math.hypot(dx, dz) || 1;
			return this._aller(j, this._b.x + (dx / d) * 7, this._b.z + (dz / d) * 7, j.vmax * 0.9);
		}
		const [tx, tz] = this._positionTactique(j);
		return this._aller(j, tx, tz, j.vmax * 0.8);
	}

	private _contactTacle(j: Joueur): void {
		const p = this._porteur;
		const [fx, fz] = dirDepuis(j.cap);
		const px = j.x + fx * 0.6;
		const pz = j.z + fz * 0.6;
		if (p && p.equipe !== j.equipe && Math.hypot(p.x - px, p.z - pz) < 1.2) {
			const reussite = 0.55 + STATS[j.equipe].def * 0.03;
			if (Math.random() < reussite) {
				this._porteur = null;
				this._dernier = j;
				this._bv.set(fx * 6 + hasard(-1.5, 1.5), 1.2, fz * 6 + hasard(-1.5, 1.5));
				p.sonne = 0.8;
				p.vx = fx * 3;
				p.vz = fz * 3;
				p.bloque = 0.9;
				this._audio.tacle();
			}
			j.action!.t = j.action!.duree; // fin du tacle
		} else if (!p && Math.hypot(this._b.x - px, this._b.z - pz) < 1.0 && this._b.y < 0.8) {
			this._dernier = j;
			this._bv.set(fx * 7, 1.0, fz * 7);
			j.bloque = 0.25;
		}
	}

	// ------------------------------------------------------------------ gardiens

	private _majGardiens(h: number): void {
		for (const g of this._joueurs) {
			if (!g.gardien || g.sonne > 0) {
				continue;
			}
			const s = sens(g.equipe);
			const butX = -L * s;
			// gardien qui a le ballon : relance après un temps
			if (this._porteur === g) {
				g.vx = g.vz = 0;
				const t = (this._decisionIA.get(g) ?? 1.3) - h;
				this._decisionIA.set(g, t);
				if (t <= 0) {
					this._decisionIA.delete(g);
					this._passe(g, [s, hasard(-0.6, 0.6)]);
				}
				continue;
			}
			// plongeon en cours
			if (g.action?.type === "plongeon") {
				g.z += g.action.vz! * h * (1 - g.action.t / g.action.duree);
				g.action.t += h;
				if (g.action.t >= g.action.duree) {
					g.action = null;
				}
				continue;
			}
			// lecture du tir
			const versBut = this._bv.x * s < -6 && !this._porteur;
			if (versBut && this._gardienDecide !== this._tirId) {
				const t = (butX - this._b.x) / this._bv.x;
				if (t > 0 && t < 1.2) {
					this._gardienDecide = this._tirId;
					const zc = this._b.z + this._bv.z * t;
					const yc = this._b.y + this._bv.y * t - 0.5 * G * t * t;
					if (Math.abs(zc) < BUT_Z + 0.5 && yc < BUT_H + 0.4) {
						const reflexe = g.equipe === this._p.equipe ? 0.7 : [0.5, 0.66, 0.82][this._p.difficulte];
						const dz = zc - g.z;
						const vitesse = Math.hypot(this._bv.x, this._bv.z);
						const chance = reflexe - Math.abs(dz) * 0.09 - Math.max(0, vitesse - 22) * 0.02 - Math.max(0, yc - 1.8) * 0.15;
						this._arretReussi = Math.random() < chance;
						if (Math.abs(dz) > 0.9) {
							// le côté du plongeon est relatif à son orientation
							const cote = Math.sign(dz) * (g.equipe === "rouge" ? -1 : 1);
							const portee = this._arretReussi ? dz : dz * hasard(0.3, 0.7);
							g.action = { type: "plongeon", t: 0, duree: Math.max(0.45, t + 0.1), cote, vz: portee / Math.max(0.3, t) };
						}
					} else {
						this._arretReussi = false;
					}
				}
			}
			const [tx, tz] = this._positionTactique(g);
			// sort de sa cage si le ballon libre traîne dans la surface
			let cx = tx;
			let cz = tz;
			const dansSurface = Math.abs(this._b.x - butX) < 14 && Math.abs(this._b.z) < 18;
			if (!this._porteur && dansSurface && Math.hypot(this._bv.x, this._bv.z) < 8) {
				cx = this._b.x;
				cz = this._b.z;
			}
			const [vx, vz] = this._aller(g, cx, cz, 6.5);
			g.vx = vx;
			g.vz = vz;
			g.x += vx * h;
			g.z += vz * h;
			g.cap = s > 0 ? 0 : Math.PI;
		}
	}

	// ------------------------------------------------------------------ ballon

	/** Le joueur prend le ballon : il glisse en douceur jusqu'à ses pieds au lieu de s'y téléporter. */
	private _prendre(j: Joueur): void {
		this._porteur = j;
		this._dernier = j;
		this._tirEquipe = null;
		this._priseT = PRISE_DUREE;
		this._priseDepart.copyFrom(this._b);
	}

	/**
	 * Aimantation à la réception : quand le ballon est libre, à terre et pas trop rapide, le joueur de champ
	 * le plus proche l'attire progressivement devant ses pieds (dans sa direction de course).
	 */
	private _aimanter(h: number): void {
		const vitesse = Math.hypot(this._bv.x, this._bv.z);
		if (this._etat !== "jeu" || this._b.y > 0.9 || vitesse > 16 || this._dansFilet) {
			return;
		}
		let proche: Joueur | null = null;
		let dMin = RAYON_AIMANT;
		for (const j of this._joueurs) {
			if (j.gardien || j.bloque > 0 || j.sonne > 0 || j.action?.type === "tacle") continue;
			const d = Math.hypot(j.x - this._b.x, j.z - this._b.z);
			if (d < dMin) {
				dMin = d;
				proche = j;
			}
		}
		if (!proche) {
			return;
		}
		// « devant » = sa direction de course ; à l'arrêt, du côté où se trouve le ballon
		let [dx, dz] = dirDepuis(proche.cap);
		if (Math.hypot(proche.vx, proche.vz) < 1) {
			const n = dMin || 1;
			dx = (this._b.x - proche.x) / n;
			dz = (this._b.z - proche.z) / n;
		}
		const cx = proche.x + dx * 0.55;
		const cz = proche.z + dz * 0.55;
		const force = 1 - dMin / RAYON_AIMANT; // 0 au bord de la zone, 1 au contact
		const a = clamp(h * (4 + 14 * force));
		this._bv.x = lerp(this._bv.x, proche.vx + (cx - this._b.x) * 7, a);
		this._bv.z = lerp(this._bv.z, proche.vz + (cz - this._b.z) * 7, a);
	}

	private _majBallon(h: number): void {
		const p = this._porteur;
		if (p) {
			const [fx, fz] = dirDepuis(p.cap);
			const cible = new Vector3();
			if (p.gardien) {
				cible.set(p.x + fx * 0.35, 1.15, p.z + fz * 0.35);
			} else {
				const vit = Math.hypot(p.vx, p.vz);
				const avance = 0.5 + 0.25 * Math.abs(Math.sin(p.phase));
				cible.set(p.x + fx * avance, R + 0.03 * Math.abs(Math.sin(p.phase * 2)) * clamp(vit / 6), p.z + fz * avance);
			}
			if (this._priseT > 0) {
				this._priseT = Math.max(0, this._priseT - h);
				this._b.copyFrom(Vector3.Lerp(this._priseDepart, cible, ss(0, 1, 1 - this._priseT / PRISE_DUREE)));
			} else {
				this._b.copyFrom(cible);
			}
			this._bv.set(p.vx, 0, p.vz);
			this._fx.trainee(false, this._monde(this._b));
			return;
		}
		this._bv.y -= G * h;
		this._b.addInPlace(this._bv.scale(h));
		if (this._b.y < R) {
			this._b.y = R;
			if (this._bv.y < -1.5) {
				this._bv.y = -this._bv.y * 0.5;
				this._bv.x *= 0.85;
				this._bv.z *= 0.85;
			} else {
				this._bv.y = 0;
			}
		}
		const auSol = this._b.y <= R + 0.01;
		const frottement = auSol ? 1.1 : 0.12;
		this._bv.x *= Math.max(0, 1 - frottement * h);
		this._bv.z *= Math.max(0, 1 - frottement * h);
		this._aimanter(h);

		// poteaux et barre
		for (const sx of [-1, 1]) {
			const px = L * sx;
			for (const sz of [-1, 1]) {
				const pz = BUT_Z * sz;
				const dx = this._b.x - px;
				const dz = this._b.z - pz;
				const d = Math.hypot(dx, dz);
				if (d < R + 0.06 && this._b.y < BUT_H) {
					const nx = dx / d;
					const nz = dz / d;
					const vn = this._bv.x * nx + this._bv.z * nz;
					if (vn < 0) {
						this._bv.x -= 1.7 * vn * nx;
						this._bv.z -= 1.7 * vn * nz;
						this._audio.poteau();
					}
				}
			}
			if (Math.abs(this._b.x - px) < R + 0.06 && Math.abs(this._b.y - BUT_H) < R + 0.06 && Math.abs(this._b.z) < BUT_Z && this._bv.x * sx > 0) {
				this._bv.x *= -0.6;
				this._bv.y = Math.abs(this._bv.y) * 0.6;
				this._audio.poteau();
			}
			// dans le filet : freinage brutal
			if (this._dansFilet && Math.abs(this._b.x) > L) {
				this._bv.scaleInPlace(Math.max(0, 1 - 6 * h));
				this._b.x = clamp(this._b.x, -L - 2, L + 2);
				this._b.z = clamp(this._b.z, -BUT_Z + R, BUT_Z - R);
				this._b.y = Math.min(this._b.y, BUT_H - R);
			}
		}
		const vit = this._bv.length();
		this._fx.trainee(vit > 20, this._monde(this._b));
		// rotation du ballon
		const vh = Math.hypot(this._bv.x, this._bv.z);
		if (vh > 0.05) {
			const axe = new Vector3(this._bv.z, 0, -this._bv.x).normalize();
			this._ballonRot = Quaternion.RotationAxis(axe, -(vh * h) / R).multiply(this._ballonRot);
		}
	}

	private _prises(): void {
		if (this._porteur) {
			// vol du ballon au contact (sans tacle)
			const p = this._porteur;
			if (p.gardien) return;
			for (const o of this._joueurs) {
				if (o.equipe === p.equipe || o.bloque > 0 || o.sonne > 0 || o.gardien) continue;
				if (Math.hypot(o.x - this._b.x, o.z - this._b.z) < 0.7) {
					const humain = o === this._controle;
					const taux = humain ? 1.4 : 0.5 + STATS[o.equipe].def * 0.06 + this._p.difficulte * 0.2;
					if (Math.random() < taux * PAS) {
						this._prendre(o);
						p.bloque = 0.6;
						if (o.equipe === this._p.equipe) this._controle = o;
					}
				}
			}
			return;
		}
		const vitesse = this._bv.length();
		for (const j of this._joueurs) {
			if (j.bloque > 0 || j.sonne > 0) continue;
			const d = Math.hypot(j.x - this._b.x, j.z - this._b.z);
			if (j.gardien) {
				const s = sens(j.equipe);
				const dansSurface = Math.abs(this._b.x - -L * s) < 16.5 && Math.abs(this._b.z) < 20;
				const portee = j.action?.type === "plongeon" ? 1.9 : 1.3;
				const tirAdverse = this._tirEquipe && this._tirEquipe !== j.equipe && vitesse > 12;
				if (dansSurface && d < portee && this._b.y < 2.6) {
					if (tirAdverse && !this._arretReussi) continue;
					if (tirAdverse && Math.random() < 0.35) {
						// parade : le ballon repart
						this._bv.set(s * hasard(6, 10), 3, Math.sign(this._b.z || 1) * hasard(4, 8));
						this._dernier = j;
						this._tirEquipe = null;
						j.bloque = 0.5;
						this._audio.frappe(0.6);
						this._audio.occasion();
						return;
					}
					this._prendre(j);
					this._bv.set(0, 0, 0);
					this._decisionIA.set(j, 1.3);
					if (tirAdverse) this._audio.occasion();
					return;
				}
				continue;
			}
			if (d < 0.85 && this._b.y < 1.3) {
				if (vitesse > 19 && Math.random() < 0.5) {
					// contre : le ballon est dévié
					this._bv.scaleInPlace(0.35);
					this._bv.x += hasard(-3, 3);
					this._bv.z += hasard(-3, 3);
					this._dernier = j;
					j.bloque = 0.3;
					continue;
				}
				this._prendre(j);
				if (j.equipe === this._p.equipe) this._controle = j;
				return;
			}
		}
	}

	private _regles(): void {
		const b = this._b;
		// but ?
		if (Math.abs(b.x) > L + R && Math.abs(b.z) < BUT_Z && b.y < BUT_H && !this._dansFilet) {
			this._dansFilet = true;
			const equipe: Equipe = b.x > 0 ? "rouge" : "bleu";
			this._but(equipe);
			return;
		}
		if (this._dansFilet) return;
		// sortie de but
		if (Math.abs(b.x) > L + 0.3) {
			const defense: Equipe = b.x > 0 ? "bleu" : "rouge";
			this._arreter("SORTIE DE BUT", () => {
				const g = this._joueurs.find((j) => j.gardien && j.equipe === defense)!;
				g.x = (L - 5.5) * Math.sign(b.x);
				g.z = 0;
				this._porteur = g;
				this._dernier = g;
				this._decisionIA.set(g, 1.0);
				this._b.set(g.x, 1.15, g.z);
				this._bv.set(0, 0, 0);
			});
			return;
		}
		// touche
		if (Math.abs(b.z) > W + 0.3) {
			const equipe = autre(this._dernier?.equipe ?? "rouge");
			const x = clamp(b.x, -L + 2, L - 2);
			const z = (W - 0.4) * Math.sign(b.z);
			this._arreter("TOUCHE", () => {
				const j = this._plusProche(this._joueurs.filter((k) => k.equipe === equipe && !k.gardien), x, z)!;
				j.x = x;
				j.z = z;
				j.vx = j.vz = 0;
				j.cap = capDepuis(0, -Math.sign(z));
				this._porteur = j;
				this._dernier = j;
				this._b.set(x, R, z);
				this._bv.set(0, 0, 0);
				if (equipe === this._p.equipe) this._controle = j;
			});
		}
	}

	private _arreter(texte: string, reprise: () => void): void {
		this._etat = "arret";
		this._etatT = 0;
		this._porteur = null;
		this._bv.set(0, 0, 0);
		this._tirEquipe = null;
		this._charge = -1;
		this._apresArret = reprise;
		this._ui.message(texte, 1.0);
		this._audio.sifflet(1);
	}

	// ------------------------------------------------------------------ but / fin

	private _but(equipe: Equipe): void {
		if (equipe === "rouge") this.scoreRouge++;
		else this.scoreBleu++;
		this._etat = "but";
		this._etatT = 0;
		this._butEquipe = equipe;
		this._porteur = null;
		this._tirEquipe = null;
		this._charge = -1;
		const d = this._dernier;
		this._buteur = d && d.equipe === equipe && !d.gardien ? d : this._plusProche(this._joueurs.filter((j) => j.equipe === equipe && !j.gardien), this._b.x, this._b.z);
		for (const j of this._joueurs) {
			j.action = null;
			j.feteT = 0;
			j.fete = j === this._buteur ? "buteur" : j.equipe === equipe ? "joie" : j.gardien ? "triste" : Math.random() < 0.5 ? "mainsTete" : "triste";
		}
		this._orbite = Math.atan2(this._camPos.z - (this._buteur?.z ?? 0), this._camPos.x - (this._buteur?.x ?? 0));
		this._audio.filet();
		this._audio.clameur();
		this._audio.jingle();
		this._audio.sifflet(1);
		this._fx.celebrer(equipe, 6);
		this._fx.prochainsFeux.forEach((t) => this._audio.feuArtifice(Math.max(0, t - 0.5)));
		this._ui.message("BUT !!!", 3, true);
	}

	private _majFete(h: number): void {
		const buteur = this._buteur;
		// le buteur file vers le poteau de corner, les coéquipiers le rejoignent
		const coinX = clamp((buteur?.x ?? 0) + 6 * sens(this._butEquipe), -L + 4, L - 4);
		const coinZ = clamp((buteur?.z ?? 0) * 1.4 + 6 * Math.sign(buteur?.z || 1), -W + 4, W - 4);
		for (const j of this._joueurs) {
			j.feteT += h;
			let tx = j.x;
			let tz = j.z;
			let v = 0;
			if (j === buteur && j.feteT < 2.2) {
				tx = coinX;
				tz = coinZ;
				v = 8.5;
			} else if (j.fete === "joie" && buteur && !j.gardien) {
				const a = (this._joueurs.indexOf(j) * 1.7) % (Math.PI * 2);
				tx = buteur.x + Math.cos(a) * 2.2;
				tz = buteur.z + Math.sin(a) * 2.2;
				v = 7.5;
			}
			if (j === buteur && j.feteT >= 2.2 && j.feteT < 3.2) {
				// glissade à genoux
				const [fx, fz] = dirDepuis(j.cap);
				const k = 1 - (j.feteT - 2.2);
				j.x += fx * 6 * k * h;
				j.z += fz * 6 * k * h;
				j.vx = j.vz = 0;
				continue;
			}
			const [vx, vz] = v ? this._aller(j, tx, tz, v) : [0, 0];
			j.vx = lerp(j.vx, vx, clamp(h * 6));
			j.vz = lerp(j.vz, vz, clamp(h * 6));
			j.x += j.vx * h;
			j.z += j.vz * h;
			const vit = Math.hypot(j.vx, j.vz);
			if (vit > 0.5) j.cap += diffAngle(j.cap, capDepuis(j.vx, j.vz)) * clamp(h * 10);
			else if (j.fete === "joie" && buteur) j.cap += diffAngle(j.cap, capDepuis(buteur.x - j.x, buteur.z - j.z)) * clamp(h * 6);
		}
	}

	private _finMatch(): void {
		this._etat = "fin";
		this._etatT = 0;
		this._porteur = null;
		this._charge = -1;
		this._audio.sifflet(3, true);
		this._ui.message("FIN DU MATCH", 2.5);
		const gagnant: Equipe | null = this.scoreRouge > this.scoreBleu ? "rouge" : this.scoreBleu > this.scoreRouge ? "bleu" : null;
		for (const j of this._joueurs) {
			j.feteT = 0;
			j.fete = !gagnant ? "aucune" : j.equipe === gagnant ? "joie" : "triste";
			j.vx = j.vz = 0;
		}
		if (gagnant) this._fx.celebrer(gagnant, 5);
		this._audio.clameur();
		setTimeout(() => {
			this.termine = true;
			this._audio.arreterFoule();
			this._ui.afficherFin(this.scoreRouge, this.scoreBleu, this._p.equipe);
		}, 3000);
	}

	// ------------------------------------------------------------------ rendu

	private _monde(local: Vector3): Vector3 {
		return Vector3.TransformCoordinates(local, this._racine.getWorldMatrix());
	}

	private _rendre(dt: number): void {
		for (const j of this._joueurs) {
			const vit = Math.hypot(j.vx, j.vz);
			j.phase += (vit * dt) / 2.2 * Math.PI * 2;
			const p = poseCourse(j.phase, clamp(vit / 7.5));
			if (j.gardien && !j.action && this._porteur !== j) melange(p, poseGardienPret(), 1 - clamp(vit / 4));
			if (this._porteur === j && j.gardien) melange(p, poseGardienBallon(), 1);
			if (j.sonne > 0) melange(p, poseTacle(), 1);
			if (j.action) {
				const t = j.action.t / j.action.duree;
				if (j.action.type === "frappe") melange(p, poseFrappe(t), 1 - ss(0.75, 1, t));
				else if (j.action.type === "tacle") melange(p, poseTacle(), ss(0, 0.15, t) * (1 - ss(0.85, 1, t)));
				else if (j.action.type === "plongeon") melange(p, posePlongeon(j.action.cote ?? 1, t), 1);
			}
			const ft = j.feteT;
			switch (j.fete) {
				case "buteur":
					if (ft < 2.2) melange(p, poseAvion(ft * 30), ss(0.2, 0.5, ft));
					else if (ft < 3.6) melange(p, poseGenoux(), ss(2.2, 2.4, ft) * (1 - ss(3.3, 3.6, ft)));
					else melange(p, posePoing(ft), ss(3.6, 3.8, ft));
					break;
				case "joie":
					if (vit < 1.5) melange(p, poseSautJoie(ft), ss(0, 0.3, ft));
					break;
				case "mainsTete":
					melange(p, poseMainsTete(), ss(0.3, 0.8, ft));
					break;
				case "triste":
					melange(p, j.gardien ? { ...poseTeteBasse(), hz: 0.4, lG: -1.5, lD: -1.5 } : poseTeteBasse(), ss(0.3, 0.9, ft));
					break;
			}
			j.rig.appliquer(j.x, j.z, j.cap, p);
		}

		this._ballonNode.position.copyFrom(this._b);
		this._ballonNode.rotationQuaternion!.copyFrom(this._ballonRot);

		// indicateur du joueur contrôlé
		const c = this._controle;
		const visible = !!c && (this._etat === "jeu" || this._etat === "engagement" || this._etat === "arret");
		this._indicateur.setEnabled(visible);
		this._anneau.setEnabled(visible);
		if (c && visible) {
			const t = performance.now() / 1000;
			this._indicateur.position.set(c.x, 2.65 + 0.12 * Math.abs(Math.sin(t * 5)), c.z);
			this._indicateur.rotation.y = t * 3;
			this._anneau.position.set(c.x, 0.06, c.z);
		}

		this._majCamera(dt);
		this._placerAides(c, visible);
	}

	/** Projette le point au-dessus de la tête du joueur contrôlé pour y poser la bulle d'aide. */
	private _placerAides(c: Joueur | null, visible: boolean): void {
		const canvas = this._scene.getEngine().getRenderingCanvas();
		if (!c || !visible || !canvas) {
			this._ui.placerAides(0, 0, false);
			return;
		}
		this.camera.getViewMatrix(true); // la caméra vient de bouger : matrices à jour
		const moteur = this._scene.getEngine();
		const w = moteur.getRenderWidth();
		const h = moteur.getRenderHeight();
		const monde = this._monde(new Vector3(c.x, 3.1, c.z));
		const p = Vector3.Project(monde, Matrix.IdentityReadOnly, this.camera.getTransformationMatrix(), this.camera.viewport.toGlobal(w, h));
		const devant = p.z > 0 && p.z < 1;
		const r = canvas.getBoundingClientRect();
		this._ui.placerAides(r.left + (p.x / w) * r.width, r.top + (p.y / h) * r.height, devant);
	}

	private _majCamera(dt: number): void {
		let pos: Vector3;
		let cible: Vector3;
		let fov = 0.62;
		if ((this._etat === "but" || this._etat === "fin") && this._buteur && this._etat === "but") {
			// orbite autour du buteur, en se rapprochant
			const b = this._buteur;
			const k = ss(0, 2.5, this._etatT);
			this._orbite += dt * 0.55;
			const r = lerp(11, 5, k);
			pos = new Vector3(b.x + Math.cos(this._orbite) * r, lerp(4, 1.9, k), b.z + Math.sin(this._orbite) * r);
			cible = new Vector3(b.x, 1.1, b.z);
			fov = lerp(0.62, 0.55, k);
		} else {
			const ax = this._b.x + this._bv.x * 0.35;
			const az = this._b.z + this._bv.z * 0.2;
			pos = new Vector3(clamp(ax * 0.9, -44, 44), 13.5, 31 + clamp(az * 0.15, -3, 3));
			cible = new Vector3(clamp(ax, -50, 50), 0, clamp(az * 0.75 - 2, -26, 24));
			fov = 0.58 - clamp(Math.abs(az) / 140, 0, 0.08);
		}
		const lissage = clamp(dt * (this._etat === "but" ? 3 : 4.5));
		this._camPos = Vector3.Lerp(this._camPos, pos, lissage);
		this._camCible = Vector3.Lerp(this._camCible, cible, lissage);
		this.camera.position.copyFrom(this._monde(this._camPos));
		this.camera.setTarget(this._monde(this._camCible));
		this.camera.fov = lerp(this.camera.fov, fov, lissage);
	}
}
