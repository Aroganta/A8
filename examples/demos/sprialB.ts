import * as lil from 'lil-gui';
import { Audio, SpiralB } from '../../src';

export function render(audio: Audio, gui: lil.GUI) {
  const shaderCompilerPath = new URL(
    '/public/glsl_wgsl_compiler_bg.wasm',
    import.meta.url,
  ).href;
  const effect = new SpiralB(shaderCompilerPath);

  const folder = gui.addFolder('style');
  const config = {
    speed: 0.500,
    objectSize: 0.700,
    waveSize: 0.500,
    exposure: 0.200,
  };

  folder.add(config, 'speed', 0, 1).onChange((speed: number) => {
    audio.style({ speed });
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
