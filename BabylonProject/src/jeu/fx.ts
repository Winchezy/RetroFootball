/**
 * Effets visuels du stade, déclenchables pendant le match : ambiance de nuit, projecteurs (stroboscope),
 * faisceaux colorés avec cônes, panneaux LED, foule qui saute, particules (confettis, feux d'artifice,
 * pyro, traînée du ballon, flashs photo). Repris et adapté de `scripts/retroFootballCinematique.ts`.
 */
import {
	Color3,
	Color4,
	DefaultRenderingPipeline,
	DynamicTexture,
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
	Camera,
} from "@babylonjs/core";

import { ss } from "./rig";

export const MAX_LUMIERES = 8;
const COULEURS_LED_ROUGE = [new Color3(1, 0.05, 0.05), new Color3(1, 1, 1), new Color3(1, 0.75, 0.1)];
const COULEURS_LED_BLEU = [new Color3(0.1, 0.3, 1), new Color3(1, 1, 1), new Color3(1, 0.85, 0.1)];

type Salve = { ps: ParticleSystem; t: number; fait: boolean };

export class EffetsStade {
	private readonly _scene: Scene;
	private readonly _q: number;
	private _t = 0;
	/** fin de la fête en cours (secondes de jeu), et couleurs de l'équipe qui a marqué */
	private _feteFin = -1;
	private _feteDebut = -1;
	private _couleursFete = COULEURS_LED_ROUGE;

	private _projecteurs: { light: Light; base: number }[] = [];
	private _faisceaux: { light: Light; cone: Mesh }[] = [];
	private _intensiteFaisceaux = 40000;
	private _leds: { mat: any; couleur: Color3; intensite: number }[] = [];
	private _foules: { node: TransformNode; base: number; phase: number; equipe: "rouge" | "bleu" }[] = [];
	private _sautFoule: "rouge" | "bleu" | null = null;

	private _confettis: ParticleSystem[] = [];
	private _pyro: ParticleSystem[] = [];
	private _feux: Salve[] = [];
	private _trainee: ParticleSystem | null = null;
	private _flashs: ParticleSystem[] = [];
	private _carre!: Texture;
	private _rond!: Texture;
	private _pipeline: DefaultRenderingPipeline | null = null;

	/** Échelle monde du GLB (100 quand l'éditeur l'a importé en centimètres). */
	private readonly _u: number;

	public constructor(scene: Scene, qualite = 0.6, echelle = 1) {
		this._scene = scene;
		this._q = qualite;
		this._u = echelle;
	}

	/** Les particules vivent dans l'espace monde : on convertit tailles, vitesses, gravité et zones. */
	private _echelle(ps: ParticleSystem): void {
		const u = this._u;
		if (u === 1) {
			return;
		}
		ps.minSize *= u;
		ps.maxSize *= u;
		ps.minEmitPower *= u;
		ps.maxEmitPower *= u;
		ps.gravity.scaleInPlace(u);
		const e = ps.particleEmitterType as any;
		if (e?.minEmitBox && e?.maxEmitBox) {
			e.minEmitBox.scaleInPlace(u);
			e.maxEmitBox.scaleInPlace(u);
		}
		if (typeof e?.radius === "number") {
			e.radius *= u;
		}
	}

	// ------------------------------------------------------------------ installation

	public installer(cameras: Camera[]): void {
		const scene = this._scene;

		// Ambiance de nuit : le modèle de l'éditeur ajoute un ciel, un soleil et un éclairage de jour.
		scene.environmentIntensity = 0.12;
		scene.clearColor = new Color4(0.01, 0.015, 0.04, 1);
		["sky", "sun"].forEach((nom) => scene.getNodeByName(nom)?.setEnabled(false));

		// Pas plus de 8 lumières par matériau (limite GPU des uniform blocks).
		scene.materials.forEach((m) => {
			if ("maxSimultaneousLights" in m) {
				(m as any).maxSimultaneousLights = MAX_LUMIERES;
			}
		});
		scene.lights.forEach((l) => {
			l.renderPriority = l.name.startsWith("Pylone") ? 10 : l.name === "Lumiere_Buteur" ? 9 : l.name.startsWith("Faisceau_") ? 5 : 0;
			if (l.name.startsWith("Pylone")) {
				this._projecteurs.push({ light: l, base: l.intensity || 16000 });
			}
			if (l.name === "Lumiere_Buteur") {
				l.intensity = 0;
			}
		});

		this._installerFaisceaux();

		scene.materials.forEach((m) => {
			if (m.name.startsWith("LED_")) {
				const mat = m as PBRMaterial;
				this._leds.push({ mat, couleur: mat.emissiveColor.clone(), intensite: (mat as any).emissiveIntensity ?? 1 });
			}
		});

		// Foules (la tribune Est accueille les supporters bleus).
		scene.getNodes().forEach((n) => {
			const m = /^Tribune_(\w+)_Foule([AB])$/.exec(n.name);
			if (m) {
				const tn = n as TransformNode;
				this._foules.push({ node: tn, base: tn.position.y, phase: m[2] === "A" ? 0 : Math.PI, equipe: m[1] === "Est" ? "bleu" : "rouge" });
			}
		});

		const glow = new GlowLayer("glowRetroFootball", scene);
		glow.intensity = 0.7;
		if (cameras.length) {
			const p = new DefaultRenderingPipeline("pipelineRetroFootball", true, scene, cameras);
			p.bloomEnabled = true;
			p.bloomThreshold = 0.8;
			p.bloomWeight = 0.35;
			p.bloomKernel = 64;
			p.imageProcessingEnabled = true;
			p.imageProcessing.toneMappingEnabled = true;
			p.imageProcessing.toneMappingType = 1;
			this._pipeline = p;
		}

		this._carre = this._texture(false);
		this._rond = this._texture(true);
		this._installerParticules();
	}

	/** Ajoute une caméra au pipeline de post-effets (bloom). */
	public ajouterCamera(c: Camera): void {
		this._pipeline?.addCamera(c);
	}

	private _installerFaisceaux(): void {
		const scene = this._scene;
		const degrade = new DynamicTexture("degradeFaisceauJeu", { width: 4, height: 64 }, scene, false);
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
			const cone = MeshBuilder.CreateCylinder(`Cone_Jeu_${i}`, { height: longueur, diameterTop: rayon * 2, diameterBottom: 0.2, tessellation: 16, cap: Mesh.NO_CAP }, scene);
			const mat = new StandardMaterial(`Mat_Cone_Jeu_${i}`, scene);
			mat.disableLighting = true;
			mat.emissiveColor = light.diffuse.clone();
			mat.opacityTexture = degrade;
			mat.alpha = 0;
			mat.alphaMode = 1;
			mat.backFaceCulling = false;
			cone.material = mat;
			cone.isPickable = false;
			cone.parent = light.parent;
			const dir = light.direction.clone().normalize();
			cone.rotationQuaternion = new Quaternion();
			Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, cone.rotationQuaternion);
			cone.position = light.position.add(dir.scale(longueur / 2));
			cone.setEnabled(false);
			this._faisceaux.push({ light, cone });
		}
	}

	private _texture(rond: boolean): Texture {
		const tex = new DynamicTexture(rond ? "pixelRondJeu" : "pixelCarreJeu", { width: 16, height: 16 }, this._scene, false, Texture.NEAREST_SAMPLINGMODE);
		const ctx = tex.getContext();
		ctx.clearRect(0, 0, 16, 16);
		ctx.fillStyle = "#ffffff";
		for (let y = 0; y < 16; y++) {
			for (let x = 0; x < 16; x++) {
				if (rond ? (x - 7.5) ** 2 + (y - 7.5) ** 2 < 42 : x > 0 && x < 15 && y > 0 && y < 15) {
					ctx.fillRect(x, y, 1, 1);
				}
			}
		}
		tex.update();
		tex.hasAlpha = true;
		return tex;
	}

	private _systeme(nom: string, capacite: number, tex: Texture, additif: boolean): ParticleSystem {
		const ps = new ParticleSystem(nom, Math.max(10, Math.round(capacite)), this._scene);
		ps.particleTexture = tex;
		ps.updateSpeed = 1 / 60;
		ps.blendMode = additif ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
		ps.colorDead = new Color4(0, 0, 0, 0);
		return ps;
	}

	private _position(n: Node): Vector3 {
		const tn = n as TransformNode;
		tn.computeWorldMatrix?.(true);
		return tn.getAbsolutePosition ? tn.getAbsolutePosition().clone() : Vector3.Zero();
	}

	private _installerParticules(): void {
		const q = this._q;
		const repere = (nom: string) => this._scene.getNodeByName(nom);

		// Confettis au-dessus des tribunes (tailles Blender x, y -> Babylon x, z).
		const zones: [string, number, number][] = [["Sud", 100, 10], ["Nord", 100, 10], ["Ouest", 10, 70], ["Coin", 16, 8]];
		for (const [nom, sx, sz] of zones) {
			const n = repere(`FX_Confettis_${nom}`);
			if (!n) {
				continue;
			}
			const pos = this._position(n);
			[new Color4(0.9, 0.05, 0.05, 1), new Color4(1, 1, 1, 1), new Color4(1, 0.75, 0.1, 1), new Color4(0.1, 0.3, 1, 1)].forEach((c, k) => {
				const total = (nom === "Coin" ? 400 : 700) * q;
				const ps = this._systeme(`Confettis_${nom}_${k}`, total, this._carre, false);
				ps.emitter = pos;
				ps.createBoxEmitter(new Vector3(-1, -1, -1), new Vector3(1, -0.3, 1), new Vector3(-sx / 2, -0.5, -sz / 2), new Vector3(sx / 2, 0.5, sz / 2));
				ps.color1 = c;
				ps.color2 = c;
				ps.colorDead = new Color4(c.r, c.g, c.b, 0);
				ps.minSize = 0.1;
				ps.maxSize = 0.22;
				ps.minLifeTime = 6;
				ps.maxLifeTime = 9;
				ps.minEmitPower = 0.5;
				ps.maxEmitPower = 1.5;
				ps.gravity = new Vector3(0, -1.8, 0);
				ps.minAngularSpeed = -8;
				ps.maxAngularSpeed = 8;
				ps.emitRate = total / 3;
				(ps as any)._couleurEquipe = k === 3 ? "bleu" : k === 0 || k === 2 ? "rouge" : "toutes";
				this._confettis.push(ps);
			});
		}

		// Feux d'artifice : un système par repère, on choisit la couleur au déclenchement.
		this._scene.getNodes().forEach((n) => {
			if (!n.name.startsWith("FX_FeuArtifice_")) {
				return;
			}
			const total = 300 * Math.max(0.4, q);
			const ps = this._systeme(n.name + "_jeu", total, this._rond, true);
			ps.emitter = this._position(n);
			ps.createSphereEmitter(0.5, 0);
			ps.minSize = 0.35;
			ps.maxSize = 0.7;
			ps.minLifeTime = 0.9;
			ps.maxLifeTime = 1.6;
			ps.minEmitPower = 10;
			ps.maxEmitPower = 18;
			ps.gravity = new Vector3(0, -3, 0);
			this._feux.push({ ps, t: -1, fait: true });
		});

		// Fontaines pyro le long des panneaux.
		this._scene.getNodes().forEach((n) => {
			if (!n.name.startsWith("FX_Pyro_")) {
				return;
			}
			const ps = this._systeme(n.name + "_jeu", 600 * q, this._carre, true);
			ps.emitter = this._position(n);
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
			ps.emitRate = 500 * q;
			this._pyro.push(ps);
		});

		// Traînée pixel derrière le ballon sur les tirs puissants.
		const t = this._systeme("Trainee_Jeu", 400, this._carre, true);
		t.emitter = Vector3.Zero();
		t.createSphereEmitter(0.15, 1);
		t.color1 = new Color4(0.3, 0.9, 1, 1);
		t.color2 = new Color4(0.6, 1, 1, 1);
		t.minSize = 0.06;
		t.maxSize = 0.12;
		t.minLifeTime = 0.25;
		t.maxLifeTime = 0.4;
		t.minEmitPower = 0;
		t.maxEmitPower = 0.2;
		t.emitRate = 700;
		this._trainee = t;

		// Flashs photo dans les tribunes (permanents, plus nombreux après un but).
		const tribunes: Record<string, number[]> = { Nord: [110, 11, 7], Sud: [110, 11, 7], Est: [11, 76, 7], Ouest: [11, 76, 7] };
		for (const nom of Object.keys(tribunes)) {
			const n = repere(`FX_Flashs_${nom}`);
			if (!n) {
				continue;
			}
			const [sx, sy, sz] = tribunes[nom];
			const demi = new Vector3(sx / 2, sz / 2, sy / 2);
			const ps = this._systeme(`Flashs_Jeu_${nom}`, 30, this._carre, true);
			ps.emitter = this._position(n);
			ps.createBoxEmitter(Vector3.Zero(), Vector3.Zero(), demi.negate(), demi);
			ps.color1 = new Color4(1, 1, 1, 1);
			ps.color2 = new Color4(0.9, 0.95, 1, 1);
			ps.minSize = 0.25;
			ps.maxSize = 0.45;
			ps.minLifeTime = 0.05;
			ps.maxLifeTime = 0.08;
			ps.minEmitPower = 0;
			ps.maxEmitPower = 0;
			ps.emitRate = 25 * Math.max(0.3, q);
			ps.start();
			this._flashs.push(ps);
		}

		[...this._confettis, ...this._feux.map((f) => f.ps), ...this._pyro, ...this._flashs, ...(this._trainee ? [this._trainee] : [])].forEach((ps) => this._echelle(ps));
	}

	// ------------------------------------------------------------------ déclencheurs

	/** Fête du but : confettis, feux d'artifice, pyro, faisceaux, LED et stroboscope pendant `duree` s. */
	public celebrer(equipe: "rouge" | "bleu", duree = 6): void {
		this._feteDebut = this._t;
		this._feteFin = this._t + duree;
		this._couleursFete = equipe === "rouge" ? COULEURS_LED_ROUGE : COULEURS_LED_BLEU;
		this._sautFoule = equipe;
		const couleurs = equipe === "rouge" ? [[1, 0.15, 0.1], [1, 0.85, 0.2], [1, 1, 1]] : [[0.2, 0.5, 1], [1, 0.85, 0.2], [1, 1, 1]];
		this._confettis.forEach((ps) => {
			const c = (ps as any)._couleurEquipe;
			if (c === "toutes" || c === equipe) {
				ps.reset();
				ps.start();
				ps.targetStopDuration = 3;
			}
		});
		this._pyro.forEach((ps) => {
			ps.reset();
			ps.start();
			ps.targetStopDuration = 3;
		});
		// feux d'artifice échelonnés
		const feux = [...this._feux].sort(() => Math.random() - 0.5).slice(0, 7);
		feux.forEach((f, i) => {
			const c = couleurs[i % couleurs.length];
			f.ps.color1 = new Color4(c[0], c[1], c[2], 1);
			f.ps.color2 = new Color4(1, 1, 1, 1);
			f.ps.colorDead = new Color4(c[0], c[1], c[2], 0);
			f.t = this._t + 0.2 + i * 0.6;
			f.fait = false;
		});
		this._flashs.forEach((ps) => (ps.emitRate = 80 * Math.max(0.3, this._q)));
	}

	/** Instants (secondes depuis maintenant) où un feu d'artifice éclate — pour synchroniser le son. */
	public get prochainsFeux(): number[] {
		return this._feux.filter((f) => !f.fait).map((f) => f.t - this._t);
	}

	public set intensiteFaisceaux(v: number) {
		this._intensiteFaisceaux = v;
	}

	/** Active / coupe la traînée du ballon et la positionne. */
	public trainee(actif: boolean, position: Vector3): void {
		if (!this._trainee) {
			return;
		}
		(this._trainee.emitter as Vector3).copyFrom(position);
		if (actif && !this._trainee.isStarted()) {
			this._trainee.start();
		} else if (!actif && this._trainee.isStarted()) {
			this._trainee.stop();
		}
	}

	/** Coupe toute fête en cours (retour au menu, nouvel engagement…). */
	public calmer(): void {
		this._feteFin = -1;
		this._sautFoule = null;
		[...this._confettis, ...this._pyro].forEach((ps) => ps.stop());
		this._feux.forEach((f) => (f.fait = true));
		this._flashs.forEach((ps) => (ps.emitRate = 25 * Math.max(0.3, this._q)));
	}

	// ------------------------------------------------------------------ mise à jour

	/**
	 * Les fontaines pyro et les confettis du corner sont au ras du sol, là où la caméra vient tourner autour
	 * du buteur. Vues de trop près, leurs particules couvrent tout l'écran : on les coupe près de la caméra.
	 */
	private _eloignerDeLaCamera(): void {
		const cam = this._scene.activeCamera;
		if (!cam) {
			return;
		}
		const c = cam.globalPosition;
		const u = this._u;
		const regler = (ps: ParticleSystem, rayonCoupe: number, rayonVide: number) => {
			const base = ((ps as any)._tauxBase ??= ps.emitRate) as number;
			const e = ps.emitter as Vector3;
			const d = Math.hypot(e.x - c.x, e.z - c.z) / u; // distance au sol, en mètres
			ps.emitRate = d < rayonCoupe ? 0 : base;
			if (d < rayonVide && ps.getActiveCount() > 0) {
				ps.reset();
			}
		};
		this._pyro.forEach((ps) => regler(ps, 16, 7));
		this._confettis.filter((ps) => ps.name.startsWith("Confettis_Coin")).forEach((ps) => regler(ps, 22, 10));
	}

	public maj(dt: number): void {
		this._t += dt;
		const t = this._t;
		const enFete = t < this._feteFin;
		const depuis = t - this._feteDebut;
		this._eloignerDeLaCamera();

		// Projecteurs : stroboscope pendant la première seconde et demie de la fête.
		this._projecteurs.forEach(({ light, base }, i) => {
			let k = 1;
			if (enFete && depuis < 1.2) {
				k = (Math.floor(depuis / 0.1) + i) % 2 === 0 ? 1.6 : 0.25;
			}
			light.intensity = base * k;
		});

		// Faisceaux : s'allument pendant la fête et balaient le stade.
		const montee = enFete ? ss(0, 0.15, depuis) * (1 - ss(this._feteFin - this._feteDebut - 1, this._feteFin - this._feteDebut, depuis)) : 0;
		this._faisceaux.forEach(({ light, cone }, i) => {
			light.intensity = this._intensiteFaisceaux * montee;
			cone.setEnabled(montee > 0.01);
			(cone.material as StandardMaterial).alpha = 0.18 * montee;
			const n = light.parent as TransformNode | null;
			if (n && montee > 0) {
				if (!n.rotationQuaternion) {
					n.rotationQuaternion = Quaternion.Identity();
				}
				const side = i < 4 ? -1 : 1;
				const rx = (-side * 35 + 22 * Math.sin((t * 1.35 + i * 1.3) * 1.3)) * (Math.PI / 180);
				const rz = 25 * Math.sin(t * 1.35 + i * 2.3) * (Math.PI / 180);
				// mêmes axes que l'animation Blender (X, puis Z Blender -> Y glTF)
				Quaternion.RotationYawPitchRollToRef(rz, rx, 0, n.rotationQuaternion);
			}
		});

		// LED : douces en jeu, flash aux couleurs de l'équipe pendant la fête.
		this._leds.forEach((led, j) => {
			if (!enFete) {
				led.mat.emissiveColor = led.couleur;
				led.mat.emissiveIntensity = led.intensite;
			} else {
				const k = Math.floor(depuis / 0.2);
				led.mat.emissiveColor = this._couleursFete[(k + j) % this._couleursFete.length];
				led.mat.emissiveIntensity = led.intensite * (k % 2 === 0 ? 2.5 : 1.4);
			}
		});

		// Foule : respiration calme, saute pour l'équipe qui vient de marquer.
		this._foules.forEach((f) => {
			const calme = 0.03 * Math.sin(t * 4.5 + f.phase);
			const fete = enFete && this._sautFoule === f.equipe ? 0.32 * Math.abs(Math.sin(t * 10 + f.phase / 2)) * ss(0, 0.2, depuis) : 0;
			const triste = enFete && this._sautFoule && this._sautFoule !== f.equipe ? -0.1 : 0;
			f.node.position.y = f.base + calme + fete + triste;
		});

		// Feux d'artifice programmés.
		this._feux.forEach((f) => {
			if (!f.fait && t >= f.t) {
				f.fait = true;
				f.ps.manualEmitCount = Math.round(300 * Math.max(0.4, this._q));
				f.ps.start();
			}
		});

		if (!enFete && this._feteFin > 0) {
			this.calmer();
		}
	}
}
