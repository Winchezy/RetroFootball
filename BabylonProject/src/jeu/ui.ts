/**
 * Interface rétro du jeu : DOM injecté par-dessus le canvas Babylon (fonctionne dans le Play de l'éditeur
 * comme dans le navigateur). Écrans : titre / menu, commandes, options, choix d'équipe, intro, HUD, pause, fin.
 * Navigation au clavier (↑ ↓ ← → Entrée Échap) façon console, et à la souris.
 */
import type { AudioJeu } from "./audio";
import { IMAGE_MENU_DUEL, PORTRAIT_BLEU, PORTRAIT_ROUGE } from "./images";

export type Equipe = "rouge" | "bleu";

export type Options = {
	/** durée réelle du match en minutes */
	duree: number;
	/** 0 facile, 1 normal, 2 difficile */
	difficulte: number;
	/** 0..10 */
	volume: number;
	intro: boolean;
};

export type Rappels = {
	jouer: (equipe: Equipe) => void;
	options: (o: Options) => void;
	reprendre: () => void;
	quitterMatch: () => void;
	rejouer: () => void;
	passerIntro: () => void;
};

export const STATS: Record<Equipe, { nom: string; court: string; att: number; def: number; vit: number; couleur: string; couleur2: string }> = {
	rouge: { nom: "RED LIONS", court: "RED", att: 8, def: 6, vit: 7, couleur: "#d4142a", couleur2: "#ffffff" },
	bleu: { nom: "BLUE STARS", court: "BLU", att: 6, def: 8, vit: 7, couleur: "#1d4fd8", couleur2: "#ffd23a" },
};

const DUREES = [2, 3, 5];
const DIFFICULTES = ["FACILE", "NORMAL", "DIFFICILE"];

type Element = { el: HTMLElement; action?: () => void; gauche?: () => void; droite?: () => void };

/** Une aide de touche du HUD : `chaud` = action conseillée (mise en avant), `discret` = rappel secondaire. */
export type Aide = { touches: string[]; texte: string; chaud?: boolean; discret?: boolean };

const CSS = `
.rf-ui{position:absolute;inset:0;z-index:20;font-family:"Press Start 2P","Courier New",monospace;color:#f5e6c8;
  pointer-events:none;overflow:hidden;user-select:none;-webkit-font-smoothing:none;image-rendering:pixelated}
.rf-ui *{box-sizing:border-box}
.rf-ecran{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:auto}
.rf-cache{display:none!important}
.rf-crt{position:absolute;inset:0;pointer-events:none;z-index:50;
  background:repeating-linear-gradient(to bottom,rgba(0,0,0,.22) 0 1px,transparent 1px 3px),
  radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.55) 100%);animation:rf-flicker 4s steps(2) infinite}
@keyframes rf-flicker{0%,97%{opacity:1}98%{opacity:.85}99%{opacity:.95}}

/* ---- fond du menu ---- */
.rf-fond{position:absolute;inset:-4%;background-size:cover;background-position:50% 50%;image-rendering:pixelated;
  animation:rf-pan 24s ease-in-out infinite alternate;filter:saturate(1.15) contrast(1.05)}
@keyframes rf-pan{0%{transform:scale(1.06) translate(-1.5%,0)}100%{transform:scale(1.12) translate(1.5%,-1%)}}
.rf-fond-voile{position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,8,30,.55) 0%,rgba(6,8,30,.1) 40%,rgba(6,8,30,.85) 100%)}

/* ---- titre ---- */
.rf-titre{position:relative;text-align:center;line-height:1.15;margin-bottom:4vh;transform:rotate(-3deg)}
.rf-titre .l1,.rf-titre .l2{display:block;font-size:clamp(28px,6.5vw,86px);letter-spacing:.06em}
.rf-titre .l2{font-size:clamp(22px,5vw,66px)}
.rf-titre span.c{display:inline-block;animation:rf-vague 1.4s steps(6) infinite;
  background:linear-gradient(180deg,#fff6a8 0%,#ffd23a 45%,#ff7a1a 55%,#d4142a 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(4px 4px 0 #000) drop-shadow(-3px 0 0 rgba(0,220,255,.55)) drop-shadow(3px 0 0 rgba(255,0,80,.45))}
.rf-titre .l2 span.c{background:linear-gradient(180deg,#ffffff 0%,#cfe0ff 45%,#5b8cff 55%,#1d4fd8 100%);-webkit-background-clip:text;background-clip:text}
@keyframes rf-vague{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.rf-sous{font-size:clamp(8px,1vw,12px);color:#9fb3ff;margin-top:14px;letter-spacing:.2em}
.rf-clignote{animation:rf-clig 1s steps(1) infinite}
@keyframes rf-clig{50%{opacity:0}}
.rf-bas{position:absolute;bottom:3.5vh;left:0;right:0;text-align:center;font-size:clamp(8px,.9vw,11px);color:#c7cbe8;text-shadow:2px 2px 0 #000}

/* ---- boutons ---- */
.rf-liste{display:flex;flex-direction:column;gap:18px;align-items:center}
.rf-btn{position:relative;min-width:min(360px,70vw);padding:16px 26px;font:inherit;font-size:clamp(12px,1.5vw,18px);color:#f5e6c8;text-align:center;
  background:linear-gradient(#232a66 0 50%,#161a45 50% 100%);border:none;cursor:pointer;outline:none;
  clip-path:polygon(0 6px,6px 6px,6px 0,calc(100% - 6px) 0,calc(100% - 6px) 6px,100% 6px,100% calc(100% - 6px),calc(100% - 6px) calc(100% - 6px),calc(100% - 6px) 100%,6px 100%,6px calc(100% - 6px),0 calc(100% - 6px));
  box-shadow:inset 0 0 0 4px #0a0c22,inset 0 0 0 8px #5865c8,inset 0 -10px 0 8px rgba(0,0,0,.25);text-shadow:3px 3px 0 #000;
  transition:transform .08s steps(2),filter .08s steps(2)}
.rf-btn::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.45) 50%,transparent 65%);transform:translateX(-130%)}
.rf-btn.sel{color:#fff36b;background:linear-gradient(#e0263b 0 50%,#a10f22 50% 100%);
  box-shadow:inset 0 0 0 4px #2a0006,inset 0 0 0 8px #ffd23a,inset 0 -10px 0 8px rgba(0,0,0,.25);
  animation:rf-secousse .28s steps(3) 1,rf-lueur 1.1s steps(4) infinite .28s}
.rf-btn.sel::after{animation:rf-balayage 1.4s steps(14) infinite}
.rf-btn-fl{position:absolute;left:-48px;top:50%;transform:translateY(-50%);color:#ffd23a;font-size:clamp(14px,1.7vw,22px);opacity:0;text-shadow:3px 3px 0 #000}
.rf-btn-wrap{position:relative;display:inline-block}
.rf-btn-wrap.sel .rf-btn-fl{opacity:1;animation:rf-rebond .45s steps(2) infinite alternate}
.rf-btn.press{transform:translate(4px,5px) scale(.97);filter:brightness(2.2)}
@keyframes rf-secousse{0%{transform:translate(0,0)}33%{transform:translate(-4px,2px)}66%{transform:translate(4px,-2px)}100%{transform:translate(0,0)}}
@keyframes rf-lueur{0%,100%{filter:drop-shadow(0 0 0 #ffd23a)}50%{filter:drop-shadow(0 0 10px #ff9a1a) brightness(1.15)}}
@keyframes rf-balayage{0%{transform:translateX(-130%)}60%,100%{transform:translateX(130%)}}
@keyframes rf-rebond{from{transform:translate(-6px,-50%)}to{transform:translate(4px,-50%)}}
.rf-eclat{position:absolute;width:8px;height:8px;pointer-events:none;z-index:60;animation:rf-eclat .55s steps(6) forwards}
@keyframes rf-eclat{to{transform:translate(var(--dx),var(--dy)) scale(.3);opacity:0}}
.rf-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:55}
.rf-flash.on{animation:rf-flash .25s steps(3) forwards}
@keyframes rf-flash{0%{opacity:.75}100%{opacity:0}}

/* ---- panneaux (commandes, options, pause, fin) ---- */
.rf-panneau{position:relative;padding:34px 40px;background:rgba(8,10,34,.92);max-width:92vw;
  box-shadow:0 0 0 4px #000,0 0 0 8px #5865c8,0 0 0 12px #000,12px 12px 0 12px rgba(0,0,0,.5)}
.rf-h{font-size:clamp(16px,2.2vw,28px);color:#ffd23a;text-align:center;margin:0 0 26px;text-shadow:4px 4px 0 #a10f22}
.rf-table{display:grid;grid-template-columns:auto auto;gap:14px 28px;font-size:clamp(9px,1vw,13px);margin-bottom:26px;align-items:center}
.rf-touche{display:inline-block;padding:7px 9px;margin:0 3px 3px 0;background:#e9e2cf;color:#111;box-shadow:inset -3px -4px 0 #a79f88,0 0 0 3px #000}
.rf-opt{display:flex;justify-content:space-between;align-items:center;gap:30px;min-width:min(560px,80vw)}
.rf-opt .v{color:#fff36b}
.rf-opt .fl{color:#ffd23a}

/* ---- choix d'équipe ---- */
.rf-equipes{display:flex;align-items:center;gap:4vw;margin:2vh 0 4vh}
.rf-carte{position:relative;width:min(290px,34vw);padding:18px 16px 22px;text-align:center;cursor:pointer;background:rgba(8,10,34,.9);
  box-shadow:0 0 0 4px #000,0 0 0 8px var(--c),0 0 0 12px #000;transition:transform .1s steps(2);opacity:.55;filter:grayscale(.6)}
.rf-carte.sel{opacity:1;filter:none;animation:rf-respire 1.2s steps(4) infinite;box-shadow:0 0 0 4px #000,0 0 0 8px var(--c),0 0 0 12px #000,0 0 40px 10px var(--c)}
@keyframes rf-respire{0%,100%{transform:scale(1.04)}50%{transform:scale(1.09)}}
.rf-carte img{width:70%;image-rendering:pixelated;filter:drop-shadow(5px 5px 0 rgba(0,0,0,.6))}
.rf-carte .nom{font-size:clamp(11px,1.4vw,17px);margin:12px 0 16px;color:#fff;text-shadow:3px 3px 0 var(--c)}
.rf-stat{display:flex;align-items:center;justify-content:space-between;font-size:clamp(7px,.8vw,10px);margin:8px 6px}
.rf-blocs{display:flex;gap:3px}.rf-blocs i{width:10px;height:12px;background:#2a2f5a}.rf-blocs i.on{background:var(--c);box-shadow:inset 0 -3px 0 rgba(0,0,0,.35)}
.rf-carte .fleche{position:absolute;top:-38px;left:50%;transform:translateX(-50%);color:#ffd23a;opacity:0;font-size:22px}
.rf-carte.sel .fleche{opacity:1;animation:rf-flotte .5s steps(2) infinite alternate}
@keyframes rf-flotte{to{transform:translate(-50%,-8px)}}
.rf-vs{font-size:clamp(24px,4vw,56px);color:#fff;text-shadow:4px 4px 0 #d4142a,-4px -4px 0 #1d4fd8;animation:rf-glitch 1.6s steps(2) infinite}
@keyframes rf-glitch{0%,90%,100%{transform:none}92%{transform:translate(-4px,2px) skewX(-8deg)}95%{transform:translate(4px,-2px) skewX(8deg)}}

/* ---- HUD ---- */
.rf-hud{position:absolute;inset:0;pointer-events:none}
.rf-score{position:absolute;top:18px;left:18px;display:flex;align-items:stretch;font-size:clamp(11px,1.3vw,16px);
  box-shadow:0 0 0 4px #000,6px 6px 0 4px rgba(0,0,0,.45);background:#0b0d26}
.rf-score>div{padding:10px 12px;display:flex;align-items:center;gap:8px}
.rf-score .eq{background:var(--c);color:#fff;text-shadow:2px 2px 0 #000}
.rf-score .pts{min-width:34px;justify-content:center;color:#fff36b}
.rf-score .moi::after{content:"◄";color:#fff36b;margin-left:4px;font-size:.8em}
.rf-score .temps{background:#000;color:#7dff8a}
.rf-puissance{position:absolute;bottom:84px;left:50%;width:min(360px,60vw);transform:translateX(-50%);height:22px;background:#0b0d26;box-shadow:0 0 0 4px #000,0 0 0 7px #f5e6c8}
.rf-puissance i{display:block;height:100%;width:0;background:repeating-linear-gradient(90deg,#7dff8a 0 12px,#3fb04a 12px 14px)}
.rf-puissance.fort i{background:repeating-linear-gradient(90deg,#ffd23a 0 12px,#b98a00 12px 14px)}
.rf-puissance.max i{background:repeating-linear-gradient(90deg,#ff3b3b 0 12px,#a10f22 12px 14px)}
.rf-puissance b{position:absolute;top:-24px;left:0;font-size:10px;font-weight:normal}
.rf-msg{position:absolute;top:38%;left:0;right:0;text-align:center;font-size:clamp(20px,4vw,52px);color:#fff;text-shadow:5px 5px 0 #000;pointer-events:none}
.rf-msg.on{animation:rf-zoom .45s steps(5) forwards}
.rf-msg.but{font-size:clamp(40px,9vw,130px);background:linear-gradient(90deg,#ff3b3b,#ffd23a,#7dff8a,#5b8cff,#ff3b3b);background-size:300% 100%;
  -webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(6px 6px 0 #000);animation:rf-zoom .45s steps(5) forwards,rf-arc 1s linear infinite,rf-secousse .2s steps(3) 6}
@keyframes rf-zoom{0%{transform:scale(3);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes rf-arc{to{background-position:300% 0}}
.rf-touches{position:absolute;left:0;top:0;display:flex;gap:12px;align-items:center;white-space:nowrap;will-change:transform;
  font-size:clamp(6px,.6vw,9px);color:#e3e6ff;text-shadow:2px 2px 0 #000;padding:6px 9px;background:rgba(6,8,30,.78);
  box-shadow:0 0 0 2px #000,0 0 0 4px rgba(255,210,58,.55)}
.rf-touches:empty{display:none}
.rf-touches::after{content:"";position:absolute;left:50%;bottom:-9px;margin-left:-6px;border:6px solid transparent;border-top-color:rgba(255,210,58,.75);border-bottom:0}
.rf-touches .a{display:flex;align-items:center;gap:5px}
.rf-touches .rf-touche{padding:4px 5px;margin:0;font-size:.95em;text-shadow:none}
.rf-touches .a.discret{opacity:.55}
.rf-touches .a.chaud{color:#fff36b;animation:rf-chaud .5s steps(2) infinite}
.rf-touches .a.chaud .rf-touche{background:#ffd23a;box-shadow:inset -3px -4px 0 #b98a00,0 0 0 3px #000,0 0 12px 2px #ff9a1a}
@keyframes rf-chaud{50%{transform:translateY(-3px)}}
.rf-aide{position:absolute;bottom:16px;right:18px;font-size:clamp(7px,.75vw,10px);color:#c7cbe8;text-shadow:2px 2px 0 #000}
.rf-resultat{font-size:clamp(26px,5vw,64px);margin-bottom:22px;text-align:center;animation:rf-zoom .5s steps(5)}
.rf-resultat.v{color:#7dff8a;text-shadow:5px 5px 0 #0a5a14}.rf-resultat.d{color:#ff5050;text-shadow:5px 5px 0 #5a0a0a}.rf-resultat.n{color:#ffd23a;text-shadow:5px 5px 0 #6a4a00}
.rf-final{font-size:clamp(14px,2vw,24px);text-align:center;margin-bottom:28px}
`;

export class InterfaceRetro {
	private readonly _racine: HTMLDivElement;
	private readonly _audio: AudioJeu;
	private readonly _rappels: Rappels;
	private _options: Options;
	private _ecran: HTMLDivElement | null = null;
	private _elements: Element[] = [];
	private _sel = 0;
	private _ecranNom = "";
	private _equipe: Equipe = "rouge";
	private _hud: HTMLDivElement | null = null;
	private _msgTimer: any = null;
	private _ecouteur: (e: KeyboardEvent) => void;
	private _verrou = false;

	public constructor(conteneur: HTMLElement, audio: AudioJeu, options: Options, rappels: Rappels) {
		this._audio = audio;
		this._options = { ...options };
		this._rappels = rappels;

		if (!document.getElementById("rf-police")) {
			const lien = document.createElement("link");
			lien.id = "rf-police";
			lien.rel = "stylesheet";
			lien.href = "https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap";
			document.head.appendChild(lien);
		}
		if (!document.getElementById("rf-style")) {
			const style = document.createElement("style");
			style.id = "rf-style";
			style.textContent = CSS;
			document.head.appendChild(style);
		}
		if (getComputedStyle(conteneur).position === "static") {
			conteneur.style.position = "relative";
		}
		this._racine = document.createElement("div");
		this._racine.className = "rf-ui";
		this._racine.innerHTML = `<div class="rf-flash"></div><div class="rf-crt"></div>`;
		conteneur.appendChild(this._racine);

		this._ecouteur = (e) => this._clavier(e);
		window.addEventListener("keydown", this._ecouteur, true);
	}

	public get options(): Options {
		return { ...this._options };
	}

	/** Vrai quand un écran de menu capte le clavier. */
	public get menuActif(): boolean {
		return !!this._ecran && this._ecranNom !== "intro";
	}

	public detruire(): void {
		window.removeEventListener("keydown", this._ecouteur, true);
		this._racine.remove();
	}

	// ------------------------------------------------------------------ outils

	private _vider(): void {
		this._ecran?.remove();
		this._ecran = null;
		this._elements = [];
		this._sel = 0;
	}

	private _nouvelEcran(nom: string, html: string): HTMLDivElement {
		this._vider();
		this._ecranNom = nom;
		const d = document.createElement("div");
		d.className = "rf-ecran";
		d.innerHTML = html;
		this._racine.insertBefore(d, this._racine.querySelector(".rf-crt"));
		this._ecran = d;
		return d;
	}

	private _bouton(parent: HTMLElement, texte: string, action: () => void): HTMLElement {
		const wrap = document.createElement("div");
		wrap.className = "rf-btn-wrap";
		wrap.innerHTML = `<span class="rf-btn-fl">►</span>`;
		const b = document.createElement("button");
		b.className = "rf-btn";
		b.textContent = texte;
		wrap.appendChild(b);
		parent.appendChild(wrap);
		this._ajouter({ el: wrap, action });
		return wrap;
	}

	private _ajouter(item: Element): void {
		const index = this._elements.length;
		this._elements.push(item);
		item.el.addEventListener("mouseenter", () => this._selectionner(index));
		item.el.addEventListener("click", (e) => {
			e.stopPropagation();
			this._audio.activer();
			this._selectionner(index, true);
			this._activer();
		});
	}

	private _selectionner(i: number, silencieux = false): void {
		if (!this._elements.length) {
			return;
		}
		i = (i + this._elements.length) % this._elements.length;
		if (i === this._sel && this._elements[i].el.classList.contains("sel")) {
			return;
		}
		this._elements.forEach((it, k) => {
			it.el.classList.toggle("sel", k === i);
			it.el.querySelector(".rf-btn")?.classList.toggle("sel", k === i);
		});
		this._sel = i;
		if (!silencieux) {
			this._audio.bip();
		}
	}

	/** Effet d'appui : enfoncement, flash, éclats de pixels, son. */
	private _activer(): void {
		const item = this._elements[this._sel];
		if (!item?.action || this._verrou) {
			return;
		}
		this._verrou = true;
		const b = (item.el.querySelector(".rf-btn") as HTMLElement) ?? item.el;
		b.classList.add("press");
		const flash = this._racine.querySelector(".rf-flash") as HTMLElement;
		flash.classList.remove("on");
		void flash.offsetWidth;
		flash.classList.add("on");
		this._eclats(b);
		this._audio.valider();
		setTimeout(() => {
			b.classList.remove("press");
			this._verrou = false;
			item.action!();
		}, 180);
	}

	private _eclats(cible: HTMLElement): void {
		const r = cible.getBoundingClientRect();
		const base = this._racine.getBoundingClientRect();
		const couleurs = ["#ffd23a", "#ffffff", "#ff3b3b", "#7dff8a", "#5b8cff"];
		for (let i = 0; i < 18; i++) {
			const p = document.createElement("i");
			p.className = "rf-eclat";
			const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
			const d = 60 + Math.random() * 90;
			p.style.left = `${r.left - base.left + r.width / 2}px`;
			p.style.top = `${r.top - base.top + r.height / 2}px`;
			p.style.background = couleurs[i % couleurs.length];
			p.style.setProperty("--dx", `${Math.cos(a) * d}px`);
			p.style.setProperty("--dy", `${Math.sin(a) * d * 0.6}px`);
			this._racine.appendChild(p);
			setTimeout(() => p.remove(), 600);
		}
	}

	private _clavier(e: KeyboardEvent): void {
		if (!this._ecran || this._ecranNom === "intro") {
			if (this._ecranNom === "intro" && (e.code === "Enter" || e.code === "Space" || e.code === "Escape")) {
				e.preventDefault();
				e.stopImmediatePropagation();
				this._rappels.passerIntro();
			}
			return;
		}
		this._audio.activer();
		const it = this._elements[this._sel];
		let gere = true;
		switch (e.code) {
			case "ArrowUp":
			case "KeyW":
				this._selectionner(this._sel - 1);
				break;
			case "ArrowDown":
			case "KeyS":
				this._selectionner(this._sel + 1);
				break;
			case "ArrowLeft":
			case "KeyA":
				if (it?.gauche) {
					it.gauche();
				} else if (this._ecranNom === "equipe") {
					this._selectionner(this._sel - 1);
				}
				break;
			case "ArrowRight":
			case "KeyD":
				if (it?.droite) {
					it.droite();
				} else if (this._ecranNom === "equipe") {
					this._selectionner(this._sel + 1);
				}
				break;
			case "Enter":
			case "Space":
				this._audio.activer();
				this._activer();
				break;
			case "Escape":
				this._retour();
				break;
			default:
				gere = false;
		}
		if (gere) {
			// stopImmediatePropagation : le clavier du match (écouteur sur window) ne doit pas voir la touche
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}

	private _retour(): void {
		switch (this._ecranNom) {
			case "commandes":
			case "options":
			case "equipe":
				this._audio.retour();
				this.afficherMenu();
				break;
			case "commandes-pause":
				this._audio.retour();
				this.afficherPause();
				break;
			case "pause":
				this._audio.retour();
				this._vider();
				this._ecranNom = "";
				this._rappels.reprendre();
				break;
		}
	}

	private _fondMenu(): string {
		return `<div class="rf-fond" style="background-image:url(${IMAGE_MENU_DUEL})"></div><div class="rf-fond-voile"></div>`;
	}

	// ------------------------------------------------------------------ écrans

	public afficherMenu(): void {
		this.masquerHud();
		const lettres = (t: string) => [...t].map((c, i) => `<span class="c" style="animation-delay:${i * 0.09}s">${c}</span>`).join("");
		const e = this._nouvelEcran(
			"menu",
			`${this._fondMenu()}
			<div style="position:relative;display:flex;flex-direction:column;align-items:center">
				<div class="rf-titre"><span class="l1">${lettres("RETRO")}</span><span class="l2">${lettres("FOOTBALL")}</span>
				<div class="rf-sous">★ EDITION STADE DE NUIT ★</div></div>
				<div class="rf-liste"></div>
			</div>
			<div class="rf-bas"><span class="rf-clignote">▲▼ CHOISIR · ENTREE VALIDER</span><br><br>© 2026 RETROFOOTBALL · 1 JOUEUR</div>`,
		);
		const liste = e.querySelector(".rf-liste") as HTMLElement;
		this._bouton(liste, "JOUER", () => this.afficherChoixEquipe());
		this._bouton(liste, "COMMANDES", () => this.afficherCommandes(false));
		this._bouton(liste, "OPTIONS", () => this.afficherOptions());
		this._selectionner(0, true);
	}

	public afficherCommandes(depuisPause: boolean): void {
		const t = (...k: string[]) => k.map((x) => `<span class="rf-touche">${x}</span>`).join("");
		const e = this._nouvelEcran(
			depuisPause ? "commandes-pause" : "commandes",
			`${depuisPause ? "" : this._fondMenu()}
			<div class="rf-panneau"><h2 class="rf-h">COMMANDES</h2>
			<div class="rf-table">
				<div>${t("Z", "Q", "S", "D")} ou ${t("▲", "◄", "▼", "►")}</div><div>SE DEPLACER</div>
				<div>${t("MAJ")}</div><div>SPRINT</div>
				<div>${t("ESPACE")} ou ${t("J")}</div><div>PASSE</div>
				<div>${t("X")} ou ${t("K")} <small>(maintenir)</small></div><div>TIR CHARGE</div>
				<div>${t("C")} ou ${t("L")}</div><div>TACLE GLISSE</div>
				<div>${t("V")} ou ${t("U")}</div><div>CHANGER DE JOUEUR</div>
				<div>${t("ECHAP")} ou ${t("P")}</div><div>PAUSE</div>
			</div><div class="rf-liste"></div></div>`,
		);
		this._bouton(e.querySelector(".rf-liste") as HTMLElement, "RETOUR", () => (depuisPause ? this.afficherPause() : this.afficherMenu()));
		this._selectionner(0, true);
	}

	public afficherOptions(): void {
		const e = this._nouvelEcran("options", `${this._fondMenu()}<div class="rf-panneau"><h2 class="rf-h">OPTIONS</h2><div class="rf-liste"></div></div>`);
		const liste = e.querySelector(".rf-liste") as HTMLElement;
		const ligne = (label: string, valeur: () => string, changer: (sens: number) => void) => {
			const d = document.createElement("div");
			d.className = "rf-btn-wrap";
			d.innerHTML = `<span class="rf-btn-fl">►</span><div class="rf-btn rf-opt"><span>${label}</span><span><span class="fl">◄</span> <span class="v"></span> <span class="fl">►</span></span></div>`;
			const maj = () => ((d.querySelector(".v") as HTMLElement).textContent = valeur());
			maj();
			const go = (s: number) => {
				changer(s);
				maj();
				this._audio.changerValeur();
				this._rappels.options(this.options);
			};
			liste.appendChild(d);
			this._ajouter({ el: d, gauche: () => go(-1), droite: () => go(1), action: () => go(1) });
			(d.querySelectorAll(".fl")[0] as HTMLElement).addEventListener("click", (ev) => {
				ev.stopPropagation();
				go(-1);
			});
		};
		const o = this._options;
		ligne("DUREE", () => `${o.duree} MIN`, (s) => (o.duree = DUREES[(DUREES.indexOf(o.duree) + s + DUREES.length) % DUREES.length]));
		ligne("DIFFICULTE", () => DIFFICULTES[o.difficulte], (s) => (o.difficulte = (o.difficulte + s + 3) % 3));
		ligne("VOLUME", () => "▮".repeat(o.volume) + "▯".repeat(10 - o.volume), (s) => {
			o.volume = Math.max(0, Math.min(10, o.volume + s));
			this._audio.volume = o.volume / 10;
		});
		ligne("INTRO", () => (o.intro ? "OUI" : "NON"), () => (o.intro = !o.intro));
		this._bouton(liste, "RETOUR", () => this.afficherMenu());
		this._selectionner(0, true);
	}

	public afficherChoixEquipe(): void {
		const carte = (eq: Equipe) => {
			const s = STATS[eq];
			const blocs = (n: number) => `<span class="rf-blocs">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
			return `<div class="rf-carte" data-eq="${eq}" style="--c:${s.couleur}"><span class="fleche">▼</span>
				<img src="${eq === "rouge" ? PORTRAIT_ROUGE : PORTRAIT_BLEU}" alt="">
				<div class="nom">${s.nom}</div>
				<div class="rf-stat"><span>ATTAQUE</span>${blocs(s.att)}</div>
				<div class="rf-stat"><span>DEFENSE</span>${blocs(s.def)}</div>
				<div class="rf-stat"><span>VITESSE</span>${blocs(s.vit)}</div></div>`;
		};
		const e = this._nouvelEcran(
			"equipe",
			`${this._fondMenu()}<div style="position:relative;display:flex;flex-direction:column;align-items:center">
			<h2 class="rf-h">CHOISIS TON EQUIPE</h2>
			<div class="rf-equipes">${carte("rouge")}<div class="rf-vs">VS</div>${carte("bleu")}</div></div>
			<div class="rf-bas">◄ ► CHOISIR · ENTREE VALIDER · ECHAP RETOUR</div>`,
		);
		(["rouge", "bleu"] as Equipe[]).forEach((eq) => {
			const el = e.querySelector(`.rf-carte[data-eq="${eq}"]`) as HTMLElement;
			this._ajouter({
				el,
				action: () => {
					this._equipe = eq;
					this._audio.start();
					this._vider();
					this._ecranNom = "";
					this._rappels.jouer(eq);
				},
			});
		});
		this._selectionner(this._equipe === "rouge" ? 0 : 1, true);
	}

	/** Pendant l'intro : juste l'invite pour passer. */
	public afficherIntro(): void {
		this._vider();
		this._ecranNom = "intro";
		const d = document.createElement("div");
		d.className = "rf-aide rf-clignote";
		d.style.fontSize = "12px";
		d.textContent = "ENTREE : PASSER ►►";
		this._racine.insertBefore(d, this._racine.querySelector(".rf-crt"));
		this._ecran = d as HTMLDivElement;
	}

	public finIntro(): void {
		if (this._ecranNom === "intro") {
			this._vider();
			this._ecranNom = "";
		}
	}

	public afficherPause(): void {
		const e = this._nouvelEcran("pause", `<div class="rf-panneau"><h2 class="rf-h">PAUSE</h2><div class="rf-liste"></div></div>`);
		e.style.background = "rgba(0,0,10,.55)";
		const liste = e.querySelector(".rf-liste") as HTMLElement;
		this._bouton(liste, "REPRENDRE", () => {
			this._vider();
			this._ecranNom = "";
			this._rappels.reprendre();
		});
		this._bouton(liste, "COMMANDES", () => this.afficherCommandes(true));
		this._bouton(liste, "QUITTER LE MATCH", () => this._rappels.quitterMatch());
		this._selectionner(0, true);
	}

	public afficherFin(scoreRouge: number, scoreBleu: number, equipe: Equipe): void {
		this.masquerHud();
		const moi = equipe === "rouge" ? scoreRouge : scoreBleu;
		const lui = equipe === "rouge" ? scoreBleu : scoreRouge;
		const [texte, cls] = moi > lui ? ["VICTOIRE !", "v"] : moi < lui ? ["DEFAITE...", "d"] : ["MATCH NUL", "n"];
		const e = this._nouvelEcran(
			"fin",
			`<div class="rf-panneau"><div class="rf-resultat ${cls}">${texte}</div>
			<div class="rf-final"><span style="color:${STATS.rouge.couleur}">${STATS.rouge.nom}</span> ${scoreRouge} - ${scoreBleu} <span style="color:#5b8cff">${STATS.bleu.nom}</span></div>
			<div class="rf-liste"></div></div>`,
		);
		e.style.background = "rgba(0,0,10,.55)";
		const liste = e.querySelector(".rf-liste") as HTMLElement;
		this._bouton(liste, "REJOUER", () => {
			this._vider();
			this._ecranNom = "";
			this._rappels.rejouer();
		});
		this._bouton(liste, "MENU PRINCIPAL", () => this._rappels.quitterMatch());
		this._selectionner(0, true);
	}

	public fermerEcran(): void {
		this._vider();
		this._ecranNom = "";
	}

	// ------------------------------------------------------------------ HUD

	public afficherHud(equipe: Equipe): void {
		this.masquerHud();
		const h = document.createElement("div");
		h.className = "rf-hud";
		h.innerHTML = `
			<div class="rf-score">
				<div class="eq ${equipe === "rouge" ? "moi" : ""}" style="--c:${STATS.rouge.couleur}">${STATS.rouge.court}</div>
				<div class="pts" data-s="rouge">0</div>
				<div class="pts" data-s="bleu">0</div>
				<div class="eq ${equipe === "bleu" ? "moi" : ""}" style="--c:${STATS.bleu.couleur}">${STATS.bleu.court}</div>
				<div class="temps">00'</div>
			</div>
			<div class="rf-puissance rf-cache"><b>PUISSANCE</b><i></i></div>
			<div class="rf-msg"></div>
			<div class="rf-touches"></div>
			<div class="rf-aide">ECHAP : PAUSE</div>`;
		this._racine.insertBefore(h, this._racine.querySelector(".rf-crt"));
		this._hud = h;
		this._aidesCle = "";
	}

	private _aidesCle = "";

	/**
	 * Place la bulle d'aide au-dessus du joueur contrôlé. `x`, `y` : position à l'écran (coordonnées client)
	 * du point au-dessus de sa tête ; `visible` faux quand il est hors champ.
	 */
	public placerAides(x: number, y: number, visible: boolean): void {
		const bulle = this._hud?.querySelector(".rf-touches") as HTMLElement | null;
		if (!bulle) {
			return;
		}
		bulle.style.visibility = visible ? "visible" : "hidden";
		if (!visible) {
			return;
		}
		const base = this._racine.getBoundingClientRect();
		const l = bulle.offsetWidth;
		const marge = 8;
		// garde la bulle entièrement à l'écran
		const px = Math.max(marge + l / 2, Math.min(base.width - marge - l / 2, x - base.left));
		const py = Math.max(bulle.offsetHeight + marge, y - base.top);
		bulle.style.transform = `translate(${Math.round(px - l / 2)}px, ${Math.round(py - bulle.offsetHeight)}px)`;
	}

	/** Touches utiles dans la situation actuelle (bulle au-dessus du joueur contrôlé). */
	public majAides(aides: Aide[]): void {
		if (!this._hud) {
			return;
		}
		const cle = JSON.stringify(aides);
		if (cle === this._aidesCle) {
			return;
		}
		this._aidesCle = cle;
		const barre = this._hud.querySelector(".rf-touches") as HTMLElement;
		barre.innerHTML = aides
			.map(
				(a) =>
					`<span class="a${a.chaud ? " chaud" : ""}${a.discret ? " discret" : ""}">${a.touches.map((t) => `<span class="rf-touche">${t}</span>`).join("")}<span class="t">${a.texte}</span></span>`,
			)
			.join("");
	}

	public masquerHud(): void {
		this._hud?.remove();
		this._hud = null;
	}

	public majHud(scoreRouge: number, scoreBleu: number, minute: number, puissance: number | null): void {
		if (!this._hud) {
			return;
		}
		const set = (sel: string, v: string) => {
			const el = this._hud!.querySelector(sel) as HTMLElement;
			if (el.textContent !== v) {
				el.textContent = v;
			}
		};
		set('[data-s="rouge"]', String(scoreRouge));
		set('[data-s="bleu"]', String(scoreBleu));
		set(".temps", `${String(Math.min(90, Math.floor(minute))).padStart(2, "0")}'`);
		const barre = this._hud.querySelector(".rf-puissance") as HTMLElement;
		if (puissance === null) {
			barre.classList.add("rf-cache");
		} else {
			barre.classList.remove("rf-cache");
			barre.classList.toggle("fort", puissance > 0.6 && puissance <= 0.9);
			barre.classList.toggle("max", puissance > 0.9);
			(barre.querySelector("i") as HTMLElement).style.width = `${Math.round(puissance * 100)}%`;
		}
	}

	/** Message central (`but` = gros arc-en-ciel animé). */
	public message(texte: string, duree = 1.6, but = false): void {
		if (!this._hud) {
			return;
		}
		const m = this._hud.querySelector(".rf-msg") as HTMLElement;
		m.textContent = texte;
		m.className = "rf-msg";
		void m.offsetWidth;
		m.className = `rf-msg on${but ? " but" : ""}`;
		clearTimeout(this._msgTimer);
		this._msgTimer = setTimeout(() => {
			m.textContent = "";
			m.className = "rf-msg";
		}, duree * 1000);
	}
}
