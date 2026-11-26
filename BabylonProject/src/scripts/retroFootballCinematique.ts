/**
 * RetroFootball - cinématique du but (Babylon.js Editor 5.x)
 *
 * À attacher sur n'importe quel nœud de la scène (par ex. "Ballon" ou le nœud racine du GLB
 * RetroFootball_Stade.glb). Le script :
 *  - joue toutes les animations du GLB en même temps (action, but, célébration, caméra),
 *  - active la caméra "Camera_Principale" et anime son zoom (FOV),
 *  - recrée les particules (confettis, feux d'artifice, pyro, traînée du ballon, gazon, flashs photo)
 *    à partir des repères "FX_*" exportés depuis Blender (leurs paramètres sont dans les extras glTF),
 *  - anime les lumières (flash des projecteurs, panneaux LED, faisceaux colorés, lumière de gros plan),
 *  - joue les sons synchronisés (Web Audio).
 *
 * Les timings sont exprimés en images Blender (30 i/s) : frame 78 = le but.
 */
import {
	Color3,
	Color4,
	DefaultRenderingPipeline,
	DynamicTexture,
	FreeCamera,
	GlowLayer,
	Light,
	Mesh,
	MeshBuilder,
	Node,
	ParticleSystem,
	PBRMaterial,
	Quaternion,
	Scene,
	SpotLight,
	StandardMaterial,
	Texture,
	TransformNode,
	Vector3,
} from "@babylonjs/core";

import { IScript, visibleAsBoolean, visibleAsNumber, visibleAsString } from "babylonjs-editor-tools";

const FPS_BLENDER = 30;
const MAX_LUMIERES = 8;
const FRAME_FIN = 390;
const FRAME_BUT = 78;

/** Sons placés sur la timeline (mêmes positions que dans Blender). */
const SONS: { fichier: string; frame: number; volume: number }[] = [
	{ fichier: "foule_ambiance.wav", frame: 1, volume: 0.55 },
	{ fichier: "coup_de_pied.wav", frame: 60, volume: 1.0 },
	{ fichier: "filet.wav", frame: 79, volume: 0.9 },
	{ fichier: "but_clameur.wav", frame: 78, volume: 1.0 },
	{ fichier: "jingle_but_8bit.wav", frame: 80, volume: 0.7 },
	{ fichier: "sifflet.wav", frame: 96, volume: 0.5 },
	{ fichier: "glissade.wav", frame: 158, volume: 0.8 },
	{ fichier: "but_clameur.wav", frame: 300, volume: 0.7 },
];

/** Champ de vision vertical (radians) de la caméra Blender, échantillonné toutes les 5 images à partir de 1. */
export const FOV_CAMERA = [
	0.651, 0.651, 0.651, 0.651, 0.651, 0.651, 0.651, 0.651, 0.651, 0.651, 0.651, 0.651, 0.651, 0.651, 0.651, 0.651,
	0.6492, 0.6035, 0.5462, 0.5208, 0.5208, 0.5208, 0.5208, 0.5208, 0.5208, 0.5208, 0.5208, 0.5208, 0.5208, 0.5208,
	0.5229, 0.5786, 0.6456, 0.6464, 0.6434, 0.6398, 0.6357, 0.6313, 0.6266, 0.6217, 0.6168, 0.6119, 0.6071, 0.6024,
	0.598, 0.5939, 0.5901, 0.5868, 0.584, 0.5817, 0.5801, 0.5791, 0.5789, 0.5789, 0.5789, 0.5789, 0.5789, 0.5789,
	0.5789, 0.5789, 0.5789, 0.5789, 0.5789, 0.5789, 0.5789, 0.5789, 0.5789, 0.5816, 0.5875, 0.5963, 0.6074, 0.6202,
	0.6342, 0.6487, 0.6628, 0.6755, 0.6857, 0.6922,
];

const COULEURS_LED = [new Color3(1, 0.05, 0.05), new Color3(1, 1, 1), new Color3(1, 0.75, 0.1)];

type Effet = {
	ps: ParticleSystem;
	debut: number;
	fin: number;
	/** Nombre de particules émises d'un coup (explosion) ; sinon émission continue. */
	salve?: number;
	/** Nœud suivi par l'émetteur (ballon, buteur...). */
	suivre?: Node;
	actif: boolean;
	termine: boolean;
};

/**
 * Paramètres des repères FX_* (copie des "extras" glTF exportés par Blender), utilisés si
 * l'éditeur n'a pas conservé les métadonnées glTF lors de l'import.
 */
const FEUX: [number, number[]][] = [
	[82, [1, 0.15, 0.1]], [90, [1, 0.85, 0.2]], [98, [0.2, 0.6, 1]], [108, [1, 1, 1]], [122, [1, 0.3, 0.8]],
	[140, [0.3, 1, 0.4]], [160, [1, 0.15, 0.1]], [185, [1, 0.85, 0.2]], [215, [0.2, 0.6, 1]], [250, [1, 1, 1]],
	[285, [1, 0.3, 0.8]], [320, [0.3, 1, 0.4]], [350, [1, 0.15, 0.1]], [372, [1, 0.85, 0.2]],
];
function parametresParDefaut(nom: string): Record<string, any> {
	const confettis: Record<string, number[]> = { Sud: [100, 10, 1], Nord: [100, 10, 1], Ouest: [10, 70, 1], Coin: [16, 8, 1] };
	const tribunes: Record<string, number[]> = { Nord: [110, 11, 7], Sud: [110, 11, 7], Est: [11, 76, 7], Ouest: [11, 76, 7] };
	const suffixe = nom.split("_").pop() ?? "";
	if (nom.startsWith("FX_Confettis_")) {
		return { fx: "confettis", debut: 79, fin: 200, taille: confettis[suffixe], quantite: suffixe === "Coin" ? 1500 : 3000 };
	}
	if (nom.startsWith("FX_FeuArtifice_")) {
		const f = FEUX[parseInt(suffixe, 10)] ?? FEUX[0];
		return { fx: "feu_artifice", debut: f[0], couleur: f[1] };
	}
	if (nom.startsWith("FX_Pyro_")) {
		return { fx: "pyro", debut: 80, fin: 175 };
	}
	if (nom === "FX_Frappe") {
		return { fx: "herbe", debut: 59, fin: 62, quantite: 120 };
	}
	if (nom === "FX_Glissade") {
		return { fx: "herbe", debut: 157, fin: 186, quantite: 500 };
	}
	if (nom === "FX_Trainee_Ballon") {
		return { fx: "trainee", debut: 60, fin: 80 };
	}
	if (nom.startsWith("FX_Flashs_")) {
		return { fx: "flashs", debut: 1, fin: 390, taille: tribunes[suffixe] };
	}
	return {};
}

const ss = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

export default class RetroFootballCinematique implements IScript {
	@visibleAsString("Dossier des sons (URL)")
	public dossierAudio: string = "/audio/";

	@visibleAsNumber("Volume général", { min: 0, max: 2, step: 0.05 })
	public volume: number = 1;

	@visibleAsBoolean("Démarrer au clic (nécessaire pour le son)")
	public demarrerAuClic: boolean = true;

	@visibleAsBoolean("Boucler la cinématique")
	public boucle: boolean = true;

	@visibleAsNumber("Quantité de particules (x)", { min: 0, max: 2, step: 0.05 })
	public facteurParticules: number = 0.6;

	@visibleAsNumber("Intensité des projecteurs (x)", { min: 0, max: 5, step: 0.05 })
	public facteurProjecteurs: number = 1;

	@visibleAsNumber("Intensité des faisceaux colorés", { min: 0, max: 200000, step: 1000 })
	public intensiteFaisceaux: number = 40000;

	@visibleAsBoolean("Bloom + glow")
	public postEffets: boolean = true;

	@visibleAsBoolean("Ambiance de nuit (coupe le ciel et le soleil du modèle)")
	public ambianceNuit: boolean = true;

	@visibleAsNumber("Lumière d'environnement (IBL)", { min: 0, max: 1, step: 0.01 })
	public intensiteEnvironnement: number = 0.12;

	private _scene!: Scene;
	/** Vrai quand le jeu (retroFootballJeu) est présent : c'est lui qui joue la cinématique en intro. */
	private _desactive = false;
	private _effets: Effet[] = [];
	private _t0 = -1;
	private _enCours = false;
	private _derniereFrame = 0;

	private _audio: AudioContext | null = null;
	private _tampons = new Map<string, AudioBuffer>();
	private _sonsJoues = new Set<number>();
	private _sources: AudioBufferSourceNode[] = [];
	private _gainAmbiance: GainNode | null = null;

	private _projecteurs: { light: Light; base: number }[] = [];
	private _faisceaux: { light: Light; cone: Mesh }[] = [];
	private _lumiereGrosPlan: Light | null = null;
	private _leds: { mat: PBRMaterial | StandardMaterial; couleur: Color3; intensite: number }[] = [];
	private _camera: FreeCamera | null = null;
	private _overlay: HTMLDivElement | null = null;

	public constructor(public object: Node) {}

	public onStart(): void {
		if ((globalThis as any).__retroFootballJeu) {
			this._desactive = true;
			return;
		}
		this._scene = this.object.getScene();
		const scene = this._scene;

		// Plus de 4 lumières par matériau, mais pas plus de 8 : chaque lumière occupe un "uniform block"
		// et beaucoup de GPU n'en acceptent que 12 par shader (sinon la scène n'est jamais prête).
		scene.materials.forEach((m) => {
			if ("maxSimultaneousLights" in m) {
				(m as any).maxSimultaneousLights = MAX_LUMIERES;
			}
		});
		// Quand il y a plus de 8 lumières, Babylon garde celles de plus haute priorité.
		scene.lights.forEach((l) => {
			if (l.name.startsWith("Pylone")) {
				l.renderPriority = 10;
			} else if (l.name === "Lumiere_Buteur") {
				l.renderPriority = 9;
			} else if (l.name.startsWith("Faisceau_")) {
				l.renderPriority = 5;
			} else {
				l.renderPriority = 0;
			}
		});

		if (this.ambianceNuit) {
			// Le modèle Babylon.js Editor ajoute un ciel, un soleil et une texture d'environnement de jour.
			scene.environmentIntensity = this.intensiteEnvironnement;
			scene.clearColor = new Color4(0.01, 0.015, 0.04, 1);
			["sky", "sun"].forEach((nom) => scene.getNodeByName(nom)?.setEnabled(false));
		}

		this._preparerCamera();
		this._preparerLumieres();
		this._preparerParticules();
		if (this.postEffets) {
			this._preparerPostEffets();
		}
		this._chargerSons();

		// Fige toutes les animations sur la première image en attendant le lancement.
		scene.animationGroups.forEach((g) => {
			g.stop();
			g.start(false, 1, g.from, g.to);
			g.goToFrame(g.from);
			g.pause();
		});

		if (this.demarrerAuClic) {
			this._afficherInvite();
		} else {
			this._lancer();
		}
	}

	public onUpdate(): void {
		if (this._desactive) {
			return;
		}
		if (!this._enCours) {
			return;
		}
		const t = (performance.now() - this._t0) / 1000;
		const frame = 1 + t * FPS_BLENDER;

		if (frame > FRAME_FIN) {
			if (this.boucle) {
				this._lancer();
			} else {
				this._enCours = false;
			}
			return;
		}

		this._majCamera(frame);
		this._majLumieres(frame);
		this._majParticules(frame);
		this._majSons(frame);
		this._derniereFrame = frame;
	}

	public onStop(): void {
		this._arreterSons();
		this._effets.forEach((e) => e.ps.dispose());
		this._faisceaux.forEach((f) => f.cone.dispose());
		this._overlay?.remove();
		this._audio?.close();
	}

	// ------------------------------------------------------------------ lancement

	private _afficherInvite(): void {
		const canvas = this._scene.getEngine().getRenderingCanvas();
		const div = document.createElement("div");
		div.textContent = "▶ Cliquez pour lancer la cinématique";
		Object.assign(div.style, {
			position: "absolute",
			left: "50%",
			bottom: "10%",
			transform: "translateX(-50%)",
			padding: "12px 20px",
			font: "bold 20px monospace",
			color: "#fff",
			background: "rgba(0,0,0,0.6)",
			border: "3px solid #fff",
			cursor: "pointer",
			zIndex: "10",
		});
		(canvas?.parentElement ?? document.body).appendChild(div);
		this._overlay = div;

		const go = () => {
			window.removeEventListener("pointerdown", go);
			window.removeEventListener("keydown", go);
			div.remove();
			this._audio?.resume();
			this._lancer();
		};
		window.addEventListener("pointerdown", go);
		window.addEventListener("keydown", go);
	}

	private _lancer(): void {
		this._arreterSons();
		this._sonsJoues.clear();
		this._effets.forEach((e) => {
			e.ps.stop();
			e.ps.reset();
			e.actif = false;
			e.termine = false;
		});
		this._scene.animationGroups.forEach((g) => {
			g.stop();
			g.start(false, 1, g.from, g.to);
		});
		this._t0 = performance.now();
		this._derniereFrame = 0;
		this._enCours = true;
	}

	// ------------------------------------------------------------------ caméra

	private _preparerCamera(): void {
		const cam = this._scene.getCameraByName("Camera_Principale") as FreeCamera | null;
		if (cam) {
			this._camera = cam;
			this._scene.activeCamera = cam;
			cam.minZ = 0.1;
			cam.maxZ = 600;
		}
	}

	private _majCamera(frame: number): void {
		if (!this._camera) {
			return;
		}
		const i = Math.max(0, (frame - 1) / 5);
		const a = Math.min(FOV_CAMERA.length - 1, Math.floor(i));
		const b = Math.min(FOV_CAMERA.length - 1, a + 1);
		this._camera.fov = FOV_CAMERA[a] + (FOV_CAMERA[b] - FOV_CAMERA[a]) * (i - a);
	}

	// ------------------------------------------------------------------ lumières

	private _preparerLumieres(): void {
		const scene = this._scene;

		scene.lights.forEach((l) => {
			if (l.name.startsWith("Pylone")) {
				this._projecteurs.push({ light: l, base: l.intensity });
			}
		});

		this._lumiereGrosPlan = scene.getLightByName("Lumiere_Buteur");

		// Faisceaux : spots colorés + cône lumineux additif pour simuler le volume.
		const degrade = new DynamicTexture("degradeFaisceau", { width: 4, height: 64 }, scene, false);
		const ctx = degrade.getContext();
		const grad = ctx.createLinearGradient(0, 0, 0, 64);
		grad.addColorStop(0, "rgba(255,255,255,0)");
		grad.addColorStop(1, "rgba(255,255,255,1)");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 4, 64);
		degrade.update();
		degrade.hasAlpha = true;

		for (let i = 0; i < 6; i++) {
			const light = scene.getLightByName(`Faisceau_${i}`);
			if (!light || !(light instanceof SpotLight)) {
				continue;
			}
			light.intensity = 0;
			const longueur = 70;
			const rayon = Math.tan(light.angle / 2) * longueur;
			const cone = MeshBuilder.CreateCylinder(
				`Cone_Faisceau_${i}`,
				{ height: longueur, diameterTop: rayon * 2, diameterBottom: 0.2, tessellation: 16, cap: Mesh.NO_CAP },
				scene,
			);
			const mat = new StandardMaterial(`Mat_Faisceau_${i}`, scene);
			mat.disableLighting = true;
			mat.emissiveColor = light.diffuse.clone();
			mat.opacityTexture = degrade;
			mat.alpha = 0.18;
			mat.alphaMode = 1; // ALPHA_ADD
			mat.backFaceCulling = false;
			cone.material = mat;
			cone.isPickable = false;

			// Aligne l'axe Y du cylindre sur la direction du spot.
			cone.parent = light.parent;
			const dir = light.direction.clone().normalize();
			cone.rotationQuaternion = new Quaternion();
			Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, cone.rotationQuaternion);
			cone.position = light.position.add(dir.scale(longueur / 2));
			cone.setEnabled(false);
			this._faisceaux.push({ light, cone });
		}

		// Panneaux LED.
		scene.materials.forEach((m) => {
			if (m.name.startsWith("LED_")) {
				const mat = m as PBRMaterial;
				this._leds.push({ mat, couleur: mat.emissiveColor.clone(), intensite: (mat as any).emissiveIntensity ?? 1 });
			}
		});
	}

	private _majLumieres(frame: number): void {
		// Projecteurs : stroboscope juste après le but.
		this._projecteurs.forEach(({ light, base }, i) => {
			let k = 1;
			if (frame >= FRAME_BUT && frame < FRAME_BUT + 36) {
				const pas = Math.floor((frame - FRAME_BUT) / 3);
				k = (pas + i) % 2 === 0 ? 1.6 : 0.25;
			}
			light.intensity = base * k * this.facteurProjecteurs;
		});

		// Faisceaux colorés qui balaient le stade (la rotation vient de l'animation glTF).
		const montee = ss(FRAME_BUT, FRAME_BUT + 4, frame);
		this._faisceaux.forEach(({ light, cone }) => {
			light.intensity = this.intensiteFaisceaux * montee;
			cone.setEnabled(montee > 0);
			(cone.material as StandardMaterial).alpha = 0.18 * montee;
		});

		// Lumière douce de gros plan (portée par la caméra).
		if (this._lumiereGrosPlan) {
			this._lumiereGrosPlan.intensity = 60 * ss(150, 180, frame);
		}

		// Panneaux LED : couleurs du club qui clignotent après le but.
		this._leds.forEach((led, j) => {
			const mat = led.mat as any;
			if (frame < FRAME_BUT) {
				mat.emissiveColor = led.couleur;
				mat.emissiveIntensity = led.intensite;
			} else {
				const k = Math.floor((frame - FRAME_BUT) / 6);
				mat.emissiveColor = COULEURS_LED[(k + j) % COULEURS_LED.length];
				mat.emissiveIntensity = led.intensite * (k % 2 === 0 ? 2.5 : 1.4);
			}
		});
	}

	private _preparerPostEffets(): void {
		const glow = new GlowLayer("glowRetroFootball", this._scene);
		glow.intensity = 0.7;
		if (this._camera) {
			const pipeline = new DefaultRenderingPipeline("pipelineRetroFootball", true, this._scene, [this._camera]);
			pipeline.bloomEnabled = true;
			pipeline.bloomThreshold = 0.8;
			pipeline.bloomWeight = 0.35;
			pipeline.bloomKernel = 64;
			pipeline.imageProcessingEnabled = true;
			pipeline.imageProcessing.toneMappingEnabled = true;
			pipeline.imageProcessing.toneMappingType = 1; // ACES
		}
	}

	// ------------------------------------------------------------------ particules

	private _texture(rond: boolean): Texture {
		const tex = new DynamicTexture(rond ? "pixelRond" : "pixelCarre", { width: 16, height: 16 }, this._scene, false, Texture.NEAREST_SAMPLINGMODE);
		const ctx = tex.getContext();
		ctx.clearRect(0, 0, 16, 16);
		ctx.fillStyle = "#ffffff";
		if (rond) {
			// cercle "pixel art"
			for (let y = 0; y < 16; y++) {
				for (let x = 0; x < 16; x++) {
					if ((x - 7.5) ** 2 + (y - 7.5) ** 2 < 42) {
						ctx.fillRect(x, y, 1, 1);
					}
				}
			}
		} else {
			ctx.fillRect(1, 1, 14, 14);
		}
		tex.update();
		tex.hasAlpha = true;
		return tex;
	}

	private _systeme(nom: string, capacite: number, tex: Texture, additif: boolean): ParticleSystem {
		const ps = new ParticleSystem(nom, Math.max(10, Math.round(capacite)), this._scene);
		ps.particleTexture = tex;
		ps.updateSpeed = 1 / 60; // unités physiques : m/s, secondes
		ps.blendMode = additif ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
		ps.minAngularSpeed = 0;
		ps.maxAngularSpeed = 0;
		ps.colorDead = new Color4(0, 0, 0, 0);
		return ps;
	}

	private _position(node: Node): Vector3 {
		const tn = node as TransformNode;
		tn.computeWorldMatrix?.(true);
		return tn.getAbsolutePosition ? tn.getAbsolutePosition().clone() : Vector3.Zero();
	}

	private _preparerParticules(): void {
		const scene = this._scene;
		const carre = this._texture(false);
		const rond = this._texture(true);
		const q = this.facteurParticules;

		const points = scene.getNodes().filter((n) => n.name.startsWith("FX_") && !(n instanceof Light));
		const extras = (n: Node) => {
			const ex = n.metadata?.gltf?.extras;
			return (ex && ex.fx ? ex : parametresParDefaut(n.name)) as Record<string, any>;
		};

		for (const n of points) {
			const ex = extras(n);
			const pos = this._position(n);
			const debut = ex.debut ?? 1;
			const fin = ex.fin ?? debut + 2;
			const duree = Math.max(0.1, (fin - debut) / FPS_BLENDER);
			// Taille Blender (x, y, z) -> Babylon (x, z, y)
			const taille = ex.taille ? new Vector3(ex.taille[0], ex.taille[2], ex.taille[1]) : new Vector3(1, 1, 1);
			const demi = taille.scale(0.5);

			switch (ex.fx) {
				case "confettis": {
					const couleurs = [new Color4(0.9, 0.05, 0.05, 1), new Color4(1, 1, 1, 1), new Color4(1, 0.75, 0.1, 1)];
					couleurs.forEach((c, k) => {
						const total = ((ex.quantite ?? 3000) * q) / couleurs.length;
						const ps = this._systeme(`${n.name}_${k}`, total, carre, false);
						ps.emitter = pos;
						ps.createBoxEmitter(new Vector3(-1, -1, -1), new Vector3(1, -0.3, 1), new Vector3(-demi.x, -0.5, -demi.z), new Vector3(demi.x, 0.5, demi.z));
						ps.color1 = c;
						ps.color2 = c;
						ps.colorDead = new Color4(c.r, c.g, c.b, 0);
						ps.minSize = 0.1;
						ps.maxSize = 0.22;
						ps.minLifeTime = 7;
						ps.maxLifeTime = 11;
						ps.minEmitPower = 0.5;
						ps.maxEmitPower = 1.5;
						ps.gravity = new Vector3(0, -1.6, 0);
						ps.minAngularSpeed = -8;
						ps.maxAngularSpeed = 8;
						ps.emitRate = total / duree;
						this._effets.push({ ps, debut, fin, actif: false, termine: false });
					});
					break;
				}
				case "feu_artifice": {
					const c = ex.couleur ?? [1, 1, 1];
					const col = new Color4(c[0], c[1], c[2], 1);
					const total = 350 * Math.max(0.3, q);
					const ps = this._systeme(n.name, total, rond, true);
					ps.emitter = pos;
					ps.createSphereEmitter(0.5, 0);
					ps.color1 = col;
					ps.color2 = new Color4(1, 1, 1, 1);
					ps.colorDead = new Color4(c[0], c[1], c[2], 0);
					ps.minSize = 0.35;
					ps.maxSize = 0.7;
					ps.minLifeTime = 0.9;
					ps.maxLifeTime = 1.6;
					ps.minEmitPower = 10;
					ps.maxEmitPower = 18;
					ps.gravity = new Vector3(0, -3, 0);
					this._effets.push({ ps, debut, fin: debut + 2, salve: total, actif: false, termine: false });
					break;
				}
				case "pyro": {
					const ps = this._systeme(n.name, 700 * q, carre, true);
					ps.emitter = pos;
					ps.createDirectedSphereEmitter(0.1, new Vector3(-0.12, 1, -0.12), new Vector3(0.12, 1, 0.12));
					ps.color1 = new Color4(1, 0.55, 0.1, 1);
					ps.color2 = new Color4(1, 0.85, 0.3, 1);
					ps.minSize = 0.07;
					ps.maxSize = 0.14;
					ps.minLifeTime = 0.6;
					ps.maxLifeTime = 1.0;
					ps.minEmitPower = 8;
					ps.maxEmitPower = 11;
					ps.gravity = new Vector3(0, -9.81, 0);
					ps.emitRate = 600 * q;
					this._effets.push({ ps, debut, fin, actif: false, termine: false });
					break;
				}
				case "herbe": {
					const total = (ex.quantite ?? 150) * Math.max(0.5, q);
					const ps = this._systeme(n.name, total, carre, false);
					ps.emitter = pos;
					ps.createDirectedSphereEmitter(0.3, new Vector3(-1, 1, -1), new Vector3(1, 2, 1));
					ps.color1 = new Color4(0.2, 0.5, 0.1, 1);
					ps.color2 = new Color4(0.35, 0.25, 0.1, 1);
					ps.minSize = 0.05;
					ps.maxSize = 0.1;
					ps.minLifeTime = 0.6;
					ps.maxLifeTime = 1.2;
					ps.minEmitPower = 1.5;
					ps.maxEmitPower = 3.5;
					ps.gravity = new Vector3(0, -9.81, 0);
					ps.emitRate = total / duree;
					// L'émetteur de la glissade suit le buteur.
					this._effets.push({ ps, debut, fin, suivre: n.parent ? n : undefined, actif: false, termine: false });
					break;
				}
				case "trainee": {
					const ps = this._systeme(n.name, 400, carre, true);
					ps.emitter = pos;
					ps.createSphereEmitter(0.15, 1);
					ps.color1 = new Color4(0.3, 0.9, 1, 1);
					ps.color2 = new Color4(0.6, 1, 1, 1);
					ps.minSize = 0.06;
					ps.maxSize = 0.12;
					ps.minLifeTime = 0.25;
					ps.maxLifeTime = 0.4;
					ps.minEmitPower = 0;
					ps.maxEmitPower = 0.2;
					ps.gravity = Vector3.Zero();
					ps.emitRate = 900;
					this._effets.push({ ps, debut, fin, suivre: n, actif: false, termine: false });
					break;
				}
				case "flashs": {
					// Avant le but : quelques flashs. Après : la tribune crépite.
					[
						{ d: 1, f: FRAME_BUT - 1, taux: 40 },
						{ d: FRAME_BUT, f: FRAME_FIN, taux: 85 },
					].forEach((p, k) => {
						const ps = this._systeme(`${n.name}_${k}`, 30, carre, true);
						ps.emitter = pos;
						ps.createBoxEmitter(Vector3.Zero(), Vector3.Zero(), demi.negate(), demi);
						ps.color1 = new Color4(1, 1, 1, 1);
						ps.color2 = new Color4(0.9, 0.95, 1, 1);
						ps.minSize = 0.25;
						ps.maxSize = 0.45;
						ps.minLifeTime = 0.05;
						ps.maxLifeTime = 0.08;
						ps.minEmitPower = 0;
						ps.maxEmitPower = 0;
						ps.emitRate = p.taux * Math.max(0.3, q);
						this._effets.push({ ps, debut: p.d, fin: p.f, actif: false, termine: false });
					});
					break;
				}
			}
		}
	}

	private _majParticules(frame: number): void {
		for (const e of this._effets) {
			if (e.suivre) {
				e.ps.emitter = this._position(e.suivre);
			}
			if (!e.actif && !e.termine && frame >= e.debut) {
				e.actif = true;
				if (e.salve) {
					e.ps.manualEmitCount = Math.round(e.salve);
				}
				e.ps.start();
			}
			if (e.actif && frame >= e.fin) {
				e.actif = false;
				e.termine = true;
				e.ps.stop(); // les particules déjà émises finissent leur vie
			}
		}
	}

	// ------------------------------------------------------------------ sons

	private async _chargerSons(): Promise<void> {
		try {
			this._audio = new AudioContext();
		} catch {
			return;
		}
		const base = this.dossierAudio.endsWith("/") ? this.dossierAudio : `${this.dossierAudio}/`;
		const fichiers = [...new Set(SONS.map((s) => s.fichier).concat("feu_artifice.wav"))];
		await Promise.all(
			fichiers.map(async (f) => {
				try {
					const rep = await fetch(base + f);
					const buf = await this._audio!.decodeAudioData(await rep.arrayBuffer());
					this._tampons.set(f, buf);
				} catch (err) {
					console.warn(`[RetroFootball] son introuvable : ${base + f}`, err);
				}
			}),
		);
	}

	private _jouer(fichier: string, volume: number, decalage = 0): GainNode | null {
		const ctx = this._audio;
		const buf = this._tampons.get(fichier);
		if (!ctx || !buf || ctx.state !== "running") {
			return null;
		}
		const src = ctx.createBufferSource();
		src.buffer = buf;
		const gain = ctx.createGain();
		gain.gain.value = volume * this.volume;
		src.connect(gain).connect(ctx.destination);
		src.start(0, Math.max(0, decalage));
		src.onended = () => {
			this._sources = this._sources.filter((s) => s !== src);
		};
		this._sources.push(src);
		return gain;
	}

	private _majSons(frame: number): void {
		SONS.forEach((s, i) => {
			if (!this._sonsJoues.has(i) && frame >= s.frame) {
				this._sonsJoues.add(i);
				const gain = this._jouer(s.fichier, s.volume, (frame - s.frame) / FPS_BLENDER);
				if (s.fichier === "foule_ambiance.wav") {
					this._gainAmbiance = gain;
				}
			}
		});

		// Une détonation par feu d'artifice (le son commence 0,5 s avant l'explosion).
		this._effets.forEach((e, i) => {
			if (!e.salve) {
				return;
			}
			const cle = 1000 + i;
			if (!this._sonsJoues.has(cle) && frame >= e.debut - 15) {
				this._sonsJoues.add(cle);
				this._jouer("feu_artifice.wav", 0.35 + 0.1 * (i % 3));
			}
		});

		// L'ambiance baisse quand la clameur du but démarre.
		if (this._gainAmbiance && this._derniereFrame < FRAME_BUT && frame >= FRAME_BUT) {
			const ctx = this._audio!;
			this._gainAmbiance.gain.setValueAtTime(this._gainAmbiance.gain.value, ctx.currentTime);
			this._gainAmbiance.gain.linearRampToValueAtTime(0.3 * this.volume, ctx.currentTime + 0.4);
		}
	}

	private _arreterSons(): void {
		this._sources.forEach((s) => {
			try {
				s.stop();
			} catch {
				/* déjà terminé */
			}
		});
		this._sources = [];
		this._gainAmbiance = null;
	}
}
