import { Effect } from './effects';

export interface Options {
  canvas: HTMLCanvasElement;
  data?: HTMLMediaElement;
  effect?: Effect;
}

export class Audio {
  private analyser: AnalyserNode;
  private dataArray: Uint8Array = new Uint8Array(512).fill(0);
  private timer: number;
  private mouse = { pos: { x: 0, y: 0 }, click: 0 };
  private ready: Promise<void>;

  private classifyOutput: number = 0;
  private worker;

  oninit: () => void = () => {};
  onframe: () => void = () => {};

  constructor(private options: Options) {
    if (options.data) {
      this.initAnalyser();
    }
    if (options.effect) {
      this.initEffect();
    }
    this.initMouseListener();
  }

  private initAnalyser() {
    const { data } = this.options;
    const context = new AudioContext();
    const src = context.createMediaElementSource(data);
    const analyser = context.createAnalyser();
    this.analyser = analyser;
    src.connect(analyser);
    analyser.connect(context.destination);
    analyser.fftSize = 512;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.dataArray = dataArray;
  }

  private initEffect() {
    const { canvas, effect } = this.options;
    this.ready = effect.init(canvas);
    if (this.oninit) {
      this.ready.then(this.oninit);
    }
  }

  private initMouseListener() {
    const { canvas: $canvas } = this.options;
    const mouse = this.mouse;
    $canvas.addEventListener('mousemove', (e) => {
      if (mouse.click) {
        mouse.pos.x = e.offsetX;
        mouse.pos.y = e.offsetY;
      }
    });
    $canvas.addEventListener('mousedown', (e) => {
      mouse.click = 1;
    });
    $canvas.addEventListener('mouseup', (e) => {
      mouse.click = 0;
    });
  }

  data($audio: HTMLMediaElement) {
    this.options.data = $audio;
    this.initAnalyser();
    return this;
  }

  effect(effect: Effect) {
    if (this.options.effect && effect !== this.options.effect) {
      this.options.effect.destroy();
    }
    this.options.effect = effect;
    this.initEffect();
    return this;
  }

  style(options: any) {
    this.options.effect?.update(options);
    return this;
  }

  async play() {
    await this.ready;

    let frame = 0;
    const tick = (elapsed: number) => {
      this.analyser?.getByteFrequencyData(this.dataArray);
      this.options.effect.frame(
        frame,
        elapsed / 1000,
        this.mouse,
        this.dataArray,
        this.classifyOutput,
      );

      this.onframe();
      frame++;
      this.timer = requestAnimationFrame(tick);
    };

    this.timer = requestAnimationFrame(tick);
  }

  resize(width: number, height: number) {
    const { canvas } = this.options;
    const $canvas = canvas;
    $canvas.width = width * window.devicePixelRatio;
    $canvas.height = height * window.devicePixelRatio;
    $canvas.style.width = `${$canvas.width / window.devicePixelRatio}px`;
    $canvas.style.height = `${$canvas.height / window.devicePixelRatio}px`;

    this.options.effect.resize($canvas.width, $canvas.height);
  }

  destroy() {
    if (this.timer) {
      cancelAnimationFrame(this.timer);
    }
    this.options.effect.destroy();
    if (this.analyser) {
      this.analyser.disconnect();
    }
  }

  private toWav(audioBuffer: AudioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const bitDepth = 16;
    const headerLength = 44;
    const dataLength = length * numChannels * (bitDepth / 8);
    const totalLength = headerLength + dataLength;

    const uint8Array = new Uint8Array(totalLength);

    function writeString(view, offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    const view = new DataView(uint8Array.buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // 写入音频数据
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const offset = headerLength + (i * numChannels + channel) * (bitDepth / 8);
        const sample = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      }
    }

    return uint8Array;
  }

  private async convertAudio(file) {
    const MAX_WAVFILE_SIZE = 4 * 1024 * 1024;
    const MAX_FILE_SIZE = 1 * 1024 * 1024;

    if (file.name.split('.').pop() == 'wav') {
      if (file.size > MAX_WAVFILE_SIZE) {
        file = file.slice(0, MAX_WAVFILE_SIZE);
      }
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      return uint8Array;
    } else {
      // mp3, ogg 压缩
      if (file.size > MAX_FILE_SIZE) {
        file = file.slice(0, MAX_FILE_SIZE);
      }
      const audioContext = new AudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const wavFile = this.toWav(audioBuffer).slice(0, MAX_WAVFILE_SIZE);
      return wavFile;
    }
  }

  async classifyGenre(files: FileList): Promise<{ classifyLabel: string; classifyTime: number; classifyOutput: number }> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./classifyWorker.ts', import.meta.url), { type: 'module' });
    }

    if (!files[0]) {
      return Promise.reject(new Error('No file provided'));
    }

    const wavFile = await this.convertAudio(files[0]);
    this.worker.postMessage(wavFile);

    return new Promise((resolve, reject) => {
      this.worker.onmessage = (event) => {
        const { classifyLabel, classifyTime, classifyOutput } = event.data;
        this.classifyOutput = classifyOutput;
        resolve({ classifyLabel, classifyTime, classifyOutput });
      };
      this.worker.onerror = (e) => {
        reject(e);
      };
    });
  }
}
