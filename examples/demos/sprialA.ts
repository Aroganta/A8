import * as lil from 'lil-gui';
import { Audio, SpiralA } from '../../src';

export function render(audio: Audio, gui: lil.GUI) {
  const shaderCompilerPath = new URL(
    '/public/glsl_wgsl_compiler_bg.wasm',
    import.meta.url,
  ).href;
  const effect = new SpiralA(shaderCompilerPath);

  const folder = gui.addFolder('style');
  const config = {
    timeSpeed: 0.4,
    loopCount: 0.4,
    zWarpSize: 0.2,
    objectSize: 0.4,
    waveSize: 0.4,
    exposure: 0.3,
  };

  folder.add(config, 'timeSpeed', 0, 1).onChange((timeSpeed: number) => {
    audio.style({ timeSpeed });
  });
  folder.add(config, 'loopCount', 0, 1).onChange((loopCount: number) => {
    audio.style({ loopCount });
  });
  folder.add(config, 'zWarpSize', 0, 1).onChange((zWarpSize: number) => {
    audio.style({ zWarpSize });
  });
  folder.add(config, 'objectSize', 0, 1).onChange((objectSize: number) => {
    audio.style({ objectSize });
  });
  folder.add(config, 'waveSize', 0, 1).onChange((waveSize: number) => {
    audio.style({ waveSize });
  });
  folder.add(config, 'exposure', 0, 1).onChange((exposure: number) => {
    audio.style({ exposure });
  });

  return [effect, folder];
}
