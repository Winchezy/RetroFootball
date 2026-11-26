/**
 * Sons du jeu, entièrement synthétisés avec Web Audio (aucun fichier à charger : fonctionne dans le Play
 * de l'éditeur comme dans le navigateur). Mêmes recettes que les sons générés pour Blender :
 * bruit filtré + enveloppes pour la foule, carrés 8-bit pour l'interface.
 */
export class AudioJeu {
	private _ctx: AudioContext | null = null;
	private _maitre: GainNode | null = null;
	private _bruit: AudioBuffer | null = null;
	private _foule: GainNode | null = null;
	private _fouleSources: AudioScheduledSourceNode[] = [];
	private _volume = 0.8;

	public get pret(): boolean {
		return !!this._ctx && this._ctx.state === "running";
	}

	/** À appeler sur un geste de l'utilisateur (clic / touche) : les navigateurs l'exigent. */
	public activer(): void {
		if (!this._ctx) {
			try {
				this._ctx = new AudioContext();
			} catch {
				return;
			}
			this._maitre = this._ctx.createGain();
			this._maitre.gain.value = this._volume;
			this._maitre.connect(this._ctx.destination);
			const n = this._ctx.sampleRate * 2;
			this._bruit = this._ctx.createBuffer(1, n, this._ctx.sampleRate);
			const d = this._bruit.getChannelData(0);
			for (let i = 0; i < n; i++) {
				d[i] = Math.random() * 2 - 1;
			}
		}
		if (this._ctx.state === "suspended") {
			this._ctx.resume().catch(() => undefined);
		}
	}

	public set volume(v: number) {
		this._volume = Math.max(0, Math.min(1, v));
		if (this._maitre && this._ctx) {
			this._maitre.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.05);
		}
	}

	public get volume(): number {
		return this._volume;
	}

	public fermer(): void {
		this.arreterFoule();
		if (this._ctx && this._ctx.state !== "closed") {
			this._ctx.close().catch(() => undefined);
		}
		this._ctx = null;
	}

	// ------------------------------------------------------------------ briques

	private _source(boucle = false): AudioBufferSourceNode | null {
		if (!this._ctx || !this._bruit) {
			return null;
		}
		const s = this._ctx.createBufferSource();
		s.buffer = this._bruit;
		s.loop = boucle;
		return s;
	}

	private _filtre(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
		const f = this._ctx!.createBiquadFilter();
		f.type = type;
		f.frequency.value = freq;
		f.Q.value = q;
		return f;
	}

	/** Bruit filtré avec une enveloppe attaque / maintien / relâche. */
	private _souffle(type: BiquadFilterType, freq: number, q: number, volume: number, attaque: number, maintien: number, relache: number, delai = 0): void {
		const src = this._source();
		if (!src) {
			return;
		}
		const ctx = this._ctx!;
		const t = ctx.currentTime + delai;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(volume, t + Math.max(0.005, attaque));
		g.gain.setValueAtTime(volume, t + attaque + maintien);
		g.gain.exponentialRampToValueAtTime(0.0001, t + attaque + maintien + relache);
		src.connect(this._filtre(type, freq, q)).connect(g).connect(this._maitre!);
		src.start(t, Math.random() * 1.5);
		src.stop(t + attaque + maintien + relache + 0.05);
	}

	/** Note carrée 8-bit. */
	private _note(freq: number, debut: number, duree: number, volume = 0.12, forme: OscillatorType = "square"): void {
		if (!this._ctx) {
			return;
		}
		const ctx = this._ctx;
		const t = ctx.currentTime + debut;
		const o = ctx.createOscillator();
		o.type = forme;
		o.frequency.setValueAtTime(freq, t);
		const g = ctx.createGain();
		g.gain.setValueAtTime(volume, t);
		g.gain.setValueAtTime(volume, t + duree * 0.7);
		g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
		o.connect(g).connect(this._maitre!);
		o.start(t);
		o.stop(t + duree + 0.02);
	}

	// ------------------------------------------------------------------ interface (8-bit)

	public bip(): void {
		this._note(660, 0, 0.05, 0.08);
	}

	public valider(): void {
		this._note(523, 0, 0.06, 0.1);
		this._note(784, 0.06, 0.06, 0.1);
		this._note(1047, 0.12, 0.12, 0.1);
	}

	public retour(): void {
		this._note(523, 0, 0.06, 0.09);
		this._note(330, 0.07, 0.1, 0.09);
	}

	public changerValeur(): void {
		this._note(880, 0, 0.035, 0.07);
	}

	public start(): void {
		[392, 523, 659, 784, 1047].forEach((f, i) => this._note(f, i * 0.07, 0.09, 0.1));
		this._note(1047, 0.36, 0.3, 0.09, "triangle");
	}

	/** Jingle du but (même mélodie que le jingle 8-bit de la cinématique). */
	public jingle(): void {
		const notes: [number, number][] = [[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.18], [0, 0.05], [784, 0.09], [1047, 0.45]];
		let t = 0;
		for (const [f, d] of notes) {
			if (f) {
				this._note(f, t, d, 0.09);
				this._note(f / 2, t, d, 0.06, "square");
			}
			t += d;
		}
	}

	// ------------------------------------------------------------------ match

	/** Ambiance de foule en boucle ; `niveau` = excitation (0..1). */
	public demarrerFoule(): void {
		if (!this._ctx || this._foule) {
			return;
		}
		const ctx = this._ctx;
		this._foule = ctx.createGain();
		this._foule.gain.value = 0.0001;
		this._foule.connect(this._maitre!);
		[
			[420, 0.6, 0.5],
			[900, 0.8, 0.35],
			[1700, 1.0, 0.15],
		].forEach(([f, q, v], i) => {
			const s = this._source(true)!;
			const g = ctx.createGain();
			g.gain.value = v;
			// légère respiration de la foule
			const lfo = ctx.createOscillator();
			lfo.frequency.value = 0.15 + i * 0.11;
			const lfoGain = ctx.createGain();
			lfoGain.gain.value = v * 0.35;
			lfo.connect(lfoGain).connect(g.gain);
			s.connect(this._filtre("bandpass", f, q)).connect(g).connect(this._foule!);
			s.start(0, i * 0.4);
			lfo.start();
			this._fouleSources.push(s, lfo);
		});
		this.niveauFoule(0.25, 1.5);
	}

	public niveauFoule(niveau: number, transition = 0.4): void {
		if (this._foule && this._ctx) {
			this._foule.gain.setTargetAtTime(Math.max(0.0001, niveau * 0.5), this._ctx.currentTime, transition / 3);
		}
	}

	public arreterFoule(): void {
		this._fouleSources.forEach((s) => {
			try {
				s.stop();
			} catch {
				/* déjà arrêté */
			}
		});
		this._fouleSources = [];
		this._foule?.disconnect();
		this._foule = null;
	}

	/** Clameur du but. */
	public clameur(): void {
		this._souffle("bandpass", 800, 0.5, 0.55, 0.25, 2.8, 2.5);
		this._souffle("bandpass", 1800, 0.9, 0.25, 0.3, 2.5, 2.0);
		this._souffle("lowpass", 300, 0.7, 0.3, 0.2, 2.5, 2.0);
		this.niveauFoule(0.9, 0.3);
		setTimeout(() => this.niveauFoule(0.35, 3), 5000);
	}

	/** « Ohhh » de la foule sur une occasion ratée. */
	public occasion(): void {
		this._souffle("bandpass", 500, 1.2, 0.3, 0.15, 0.5, 1.2);
	}

	public frappe(puissance = 0.5): void {
		if (!this._ctx) {
			return;
		}
		const ctx = this._ctx;
		const t = ctx.currentTime;
		const o = ctx.createOscillator();
		o.type = "sine";
		o.frequency.setValueAtTime(150 + 60 * puissance, t);
		o.frequency.exponentialRampToValueAtTime(50, t + 0.14);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.35 + 0.35 * puissance, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
		o.connect(g).connect(this._maitre!);
		o.start(t);
		o.stop(t + 0.25);
		this._souffle("highpass", 2500, 0.7, 0.12 + 0.1 * puissance, 0.002, 0.005, 0.04);
	}

	public filet(): void {
		this._souffle("bandpass", 3200, 0.8, 0.35, 0.02, 0.08, 0.5);
	}

	public poteau(): void {
		this._note(1400, 0, 0.25, 0.08, "triangle");
		this._note(2100, 0, 0.18, 0.05, "triangle");
		this.frappe(0.8);
	}

	public tacle(): void {
		this._souffle("bandpass", 1200, 0.6, 0.25, 0.01, 0.15, 0.35);
	}

	/** Coups de sifflet : `nombre` coups (3 longs = fin du match). */
	public sifflet(nombre = 1, long = false): void {
		if (!this._ctx) {
			return;
		}
		const ctx = this._ctx;
		for (let i = 0; i < nombre; i++) {
			const t = ctx.currentTime + i * (long ? 0.75 : 0.35);
			const duree = long ? 0.55 : 0.25;
			const o = ctx.createOscillator();
			o.type = "square";
			o.frequency.value = 2750;
			const trille = ctx.createOscillator();
			trille.frequency.value = 28;
			const trilleGain = ctx.createGain();
			trilleGain.gain.value = 60;
			trille.connect(trilleGain).connect(o.frequency);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
			g.gain.setValueAtTime(0.06, t + duree - 0.04);
			g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
			o.connect(this._filtre("bandpass", 2750, 2)).connect(g).connect(this._maitre!);
			o.start(t);
			trille.start(t);
			o.stop(t + duree + 0.02);
			trille.stop(t + duree + 0.02);
		}
	}

	/** Feu d'artifice : sifflement de montée, détonation, crépitements. */
	public feuArtifice(delai = 0): void {
		if (!this._ctx) {
			return;
		}
		const ctx = this._ctx;
		const t = ctx.currentTime + delai;
		const o = ctx.createOscillator();
		o.type = "sine";
		o.frequency.setValueAtTime(700, t);
		o.frequency.exponentialRampToValueAtTime(1900, t + 0.5);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.025, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
		o.connect(g).connect(this._maitre!);
		o.start(t);
		o.stop(t + 0.52);
		this._souffle("lowpass", 900, 0.7, 0.5, 0.005, 0.05, 0.9, delai + 0.5);
		for (let i = 0; i < 14; i++) {
			this._souffle("highpass", 4000, 0.7, 0.05 + Math.random() * 0.06, 0.002, 0.004, 0.03, delai + 0.65 + Math.random() * 1.2);
		}
	}
}
