/**
 * Poses procédurales des joueurs (port du rig utilisé pour animer la cinématique dans Blender).
 *
 * Chaque joueur du GLB est une hiérarchie de nœuds : `TAG` (racine au sol) > `TAG_Bassin` > torse,
 * `TAG_Cou` > tête, `TAG_EpauleG/D` > bras, `TAG_HancheG/D` > jambes. Les angles sont exprimés comme
 * dans Blender (degrés convertis en radians) et convertis vers l'espace glTF (Y vers le haut) :
 * rotation Blender X -> glTF X, Blender Y -> glTF -Z, Blender Z -> glTF Y.
 */
import { Node, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";

export const rad = (d: number) => (d * Math.PI) / 180;
export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ss = (a: number, b: number, x: number) => {
	const t = clamp((x - a) / (b - a));
	return t * t * (3 - 2 * t);
};

/** Pose d'un joueur (mêmes canaux que dans Blender). */
export type Pose = {
	/** hauteur du bassin */
	hz: number;
	/** saut (décalage vertical de tout le corps) */
	z: number;
	/** roulis / tangage du bassin */
	hx: number;
	hy: number;
	/** tête */
	ny: number;
	/** jambes : balancier avant/arrière, écart */
	lG: number;
	lD: number;
	lGx: number;
	lDx: number;
	/** bras : écart latéral (x), balancier (y) */
	aGx: number;
	aDx: number;
	aGy: number;
	aDy: number;
};

export const poseNeutre = (): Pose => ({
	hz: 0.95,
	z: 0,
	hx: 0,
	hy: 0,
	ny: 0,
	lG: 0,
	lD: 0,
	lGx: 0,
	lDx: 0,
	aGx: rad(6),
	aDx: -rad(6),
	aGy: 0,
	aDy: 0,
});

/** Mélange `p` vers `cible` (seulement les canaux fournis). */
export function melange(p: Pose, cible: Partial<Pose>, w: number): Pose {
	if (w <= 0) {
		return p;
	}
	for (const k in cible) {
		const key = k as keyof Pose;
		p[key] = lerp(p[key], cible[key] as number, clamp(w));
	}
	return p;
}

/** Cycle de course : `phase` avance avec la distance parcourue, `amp` (0..1) avec la vitesse. */
export function poseCourse(phase: number, amp: number): Pose {
	const p = poseNeutre();
	const sn = Math.sin(phase);
	p.hz = 0.95 + 0.06 * amp * Math.abs(Math.cos(phase));
	p.hy = rad(10) * amp;
	p.ny = -rad(6) * amp;
	p.lG = -rad(42) * amp * sn;
	p.lD = rad(42) * amp * sn;
	p.aGy = rad(38) * amp * sn;
	p.aDy = -rad(38) * amp * sn;
	return p;
}

// ------------------------------------------------------------------ poses d'action (t = 0..1)

/** Frappe du pied droit : armé puis frappe. */
export const poseFrappe = (t: number): Partial<Pose> => ({
	lD: t < 0.45 ? lerp(0, rad(55), t / 0.45) : lerp(rad(55), -rad(85), clamp((t - 0.45) / 0.3)),
	lG: rad(5),
	aGx: rad(60),
	aDx: -rad(45),
	aGy: 0,
	aDy: 0,
	hy: -rad(12) * ss(0.4, 0.7, t),
});

/** Tacle glissé : couché sur le côté, jambe tendue. */
export const poseTacle = (): Partial<Pose> => ({
	hz: 0.42,
	hx: rad(55),
	hy: -rad(10),
	lD: -rad(70),
	lG: rad(10),
	aGx: rad(80),
	aDx: -rad(20),
	aGy: 0,
	aDy: 0,
});

/** Plongeon du gardien vers sa gauche (+1) ou sa droite (-1). */
export const posePlongeon = (cote: number, t: number): Partial<Pose> => ({
	hz: lerp(0.95, 0.3, ss(0.3, 1, t)) + 0.45 * Math.sin(Math.PI * clamp(t)),
	hx: -rad(80) * cote,
	aGx: rad(170),
	aDx: -rad(170),
	aGy: 0,
	aDy: 0,
	lG: 0,
	lD: 0,
});

/** Gardien prêt : fléchi, bras ouverts. */
export const poseGardienPret = (): Partial<Pose> => ({
	hz: 0.84,
	aGx: rad(32),
	aDx: -rad(32),
	aGy: -rad(15),
	aDy: -rad(15),
	lGx: rad(10),
	lDx: -rad(10),
	hy: rad(14),
});

/** Gardien qui tient le ballon contre lui. */
export const poseGardienBallon = (): Partial<Pose> => ({
	aGx: rad(20),
	aDx: -rad(20),
	aGy: -rad(75),
	aDy: -rad(75),
	hy: rad(8),
});

/** Bras en avion (course de célébration). */
export const poseAvion = (f: number): Partial<Pose> => ({
	aGx: rad(88),
	aDx: -rad(88),
	aGy: 0,
	aDy: 0,
	hx: rad(14) * Math.sin(f * 0.12),
});

/** Saut de joie, bras levés (`k` = temps en secondes). */
export const poseSautJoie = (k: number): Partial<Pose> => {
	const saut = Math.abs(Math.sin(Math.PI * k * 1.5));
	return { z: 0.5 * saut, aGx: rad(165), aDx: -rad(165), aGy: 0, aDy: 0, lG: rad(20) * saut, lD: rad(20) * saut };
};

/** Poing levé, saut (buteur). */
export const posePoing = (k: number): Partial<Pose> => {
	const saut = Math.sin(Math.PI * ((k * 1.25) % 1));
	return { z: 0.6 * saut, lG: rad(35) * saut, lD: rad(35) * saut, aDx: -rad(172), aDy: 0, aGx: rad(25), ny: -rad(15) };
};

/** Glissade à genoux, bras au ciel, tête en arrière. */
export const poseGenoux = (): Partial<Pose> => ({
	hz: 0.34,
	lG: rad(80),
	lD: rad(80),
	hy: -rad(14),
	aGx: rad(150),
	aDx: -rad(150),
	aGy: -rad(10),
	aDy: -rad(10),
	ny: -rad(30),
	hx: 0,
});

/** Mains sur la tête (déception). */
export const poseMainsTete = (): Partial<Pose> => ({
	aGx: rad(150),
	aDx: -rad(150),
	aGy: -rad(55),
	aDy: -rad(55),
	ny: rad(20),
});

/** Tête basse, mains sur les hanches. */
export const poseTeteBasse = (): Partial<Pose> => ({
	aGx: rad(28),
	aDx: -rad(28),
	aGy: rad(25),
	aDy: rad(25),
	ny: rad(30),
	hy: rad(8),
});

// ------------------------------------------------------------------ application sur les nœuds

const AXE_X = new Vector3(1, 0, 0);
const AXE_Y = new Vector3(0, 1, 0);
const AXE_MZ = new Vector3(0, 0, -1);

/** Quaternion glTF à partir d'angles Blender (ordre XYZ). */
function quatBlender(x: number, y: number, z: number, out: Quaternion): Quaternion {
	const qz = Quaternion.RotationAxis(AXE_Y, z);
	const qy = Quaternion.RotationAxis(AXE_MZ, y);
	const qx = Quaternion.RotationAxis(AXE_X, x);
	qz.multiplyToRef(qy, out);
	out.multiplyInPlace(qx);
	return out;
}

function trouver(racine: Node, nom: string): TransformNode | null {
	if (racine.name === nom) {
		return racine as TransformNode;
	}
	const d = racine.getDescendants(false, (n) => n.name === nom);
	return (d[0] as TransformNode) ?? null;
}

export class RigJoueur {
	public readonly racine: TransformNode;
	private readonly _bassin: TransformNode | null;
	private readonly _cou: TransformNode | null;
	private readonly _epG: TransformNode | null;
	private readonly _epD: TransformNode | null;
	private readonly _hG: TransformNode | null;
	private readonly _hD: TransformNode | null;

	public constructor(racine: TransformNode, tag: string) {
		this.racine = racine;
		this._bassin = trouver(racine, `${tag}_Bassin`);
		this._cou = trouver(racine, `${tag}_Cou`);
		this._epG = trouver(racine, `${tag}_EpauleG`);
		this._epD = trouver(racine, `${tag}_EpauleD`);
		this._hG = trouver(racine, `${tag}_HancheG`);
		this._hD = trouver(racine, `${tag}_HancheD`);
		[racine, this._bassin, this._cou, this._epG, this._epD, this._hG, this._hD].forEach((n) => {
			if (n && !n.rotationQuaternion) {
				n.rotationQuaternion = Quaternion.Identity();
			}
		});
	}

	/**
	 * Place le joueur. `x`, `z` : position au sol dans l'espace glTF (x = longueur du terrain,
	 * z = largeur), `cap` : orientation (radians, 0 = vers +x).
	 */
	public appliquer(x: number, z: number, cap: number, p: Pose): void {
		this.racine.position.set(x, p.z, z);
		quatBlender(0, 0, cap, this.racine.rotationQuaternion!);
		if (this._bassin) {
			this._bassin.position.y = p.hz;
			quatBlender(p.hx, p.hy, 0, this._bassin.rotationQuaternion!);
		}
		if (this._cou) {
			quatBlender(0, p.ny, 0, this._cou.rotationQuaternion!);
		}
		if (this._epG) {
			quatBlender(p.aGx, p.aGy, 0, this._epG.rotationQuaternion!);
		}
		if (this._epD) {
			quatBlender(p.aDx, p.aDy, 0, this._epD.rotationQuaternion!);
		}
		if (this._hG) {
			quatBlender(p.lGx, p.lG, 0, this._hG.rotationQuaternion!);
		}
		if (this._hD) {
			quatBlender(p.lDx, p.lD, 0, this._hD.rotationQuaternion!);
		}
	}
}

/** Cap (radians) correspondant à une direction (dx, dz) dans l'espace glTF. */
export const capDepuis = (dx: number, dz: number) => Math.atan2(-dz, dx);
/** Direction (dx, dz) d'un cap. */
export const dirDepuis = (cap: number): [number, number] => [Math.cos(cap), -Math.sin(cap)];
/** Plus courte différence d'angle. */
export const diffAngle = (a: number, b: number) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
