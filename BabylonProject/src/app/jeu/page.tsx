"use client";

/**
 * Page /jeu : charge la scène exportée par l'éditeur et lance le jeu RetroFootball,
 * même si le script n'est pas (encore) attaché dans l'éditeur.
 */
import { useEffect, useRef } from "react";

import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";

import HavokPhysics from "@babylonjs/havok";

import "@babylonjs/core/Physics";

import "@babylonjs/core/Loading/loadingScreen";
import "@babylonjs/core/Loading/Plugins/babylonFileLoader";
import "@babylonjs/core/Cameras/camera";
import "@babylonjs/core/Cameras/universalCamera";
import "@babylonjs/core/Meshes/groundMesh";
import "@babylonjs/core/Lights/directionalLight";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import "@babylonjs/core/Materials/PBR/pbrMaterial";
import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Materials/imageProcessingConfiguration";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";
import "@babylonjs/core/Materials/Textures/cubeTexture";
import "@babylonjs/core/Materials/Textures/Loaders/envTextureLoader";
import "@babylonjs/materials/sky";

import { applyScriptOnObject, getScriptByClassForObject, loadScene } from "babylonjs-editor-tools";

import { scriptsMap } from "@/scripts";
import RetroFootballJeu from "@/scripts/retroFootballJeu";

export default function Jeu() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		if (!canvasRef.current) {
			return;
		}

		const engine = new Engine(canvasRef.current, true, {
			stencil: true,
			antialias: true,
			adaptToDeviceRatio: true,
			powerPreference: "high-performance",
		});
		const scene = new Scene(engine);
		handleLoad(engine, scene);

		const listener = () => engine.resize();
		window.addEventListener("resize", listener);

		return () => {
			scene.dispose();
			engine.dispose();
			window.removeEventListener("resize", listener);
		};
	}, [canvasRef]);

	async function handleLoad(engine: Engine, scene: Scene) {
		// La scène exportée par l'éditeur active la physique : sans plugin Havok, Babylon
		// essaie l'ancien moteur Cannon (« CANNON is not defined »). Même réglage que page.tsx.
		const havok = await HavokPhysics();
		if (scene.isDisposed) {
			return;
		}
		const physique = new HavokPlugin(true, havok);
		physique.setVelocityLimits(200 * 100, 100);
		scene.enablePhysics(new Vector3(0, -981, 0), physique);

		SceneLoaderFlags.ForceFullSceneLoadingForIncremental = true;
		try {
			await loadScene("/scene/", "example.babylon", scene, scriptsMap, { quality: "high" });
		} catch (e) {
			// En développement, React monte la page deux fois : la première scène est détruite en plein chargement.
			if (scene.isDisposed) {
				return;
			}
			throw e;
		}
		if (scene.isDisposed) {
			return;
		}

		// Le jeu pilote sa propre caméra : pas de contrôle de caméra à la souris / au clavier.
		const ballon = scene.getNodeByName("Ballon") as TransformNode | null;
		if (ballon && !getScriptByClassForObject(ballon, RetroFootballJeu)) {
			applyScriptOnObject(ballon, RetroFootballJeu);
		}

		engine.runRenderLoop(() => scene.render());
	}

	return (
		<main className="relative w-screen h-screen overflow-hidden bg-black">
			<canvas ref={canvasRef} className="w-full h-full outline-none select-none" />
		</main>
	);
}
