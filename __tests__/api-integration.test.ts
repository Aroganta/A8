import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Audio } from '../src/Audio';
import { Effect } from '../src/effects';

globalThis.AudioContext = class {
  destination = {};
  createMediaElementSource() {
    return { connect: vi.fn() };
  }
  createAnalyser() {
    return {
      connect: vi.fn(),
      fftSize: 0,
      frequencyBinCount: 256,
      getByteFrequencyData: vi.fn()
    };
  }
  decodeAudioData() {
    return Promise.resolve({
      numberOfChannels: 2,
      sampleRate: 44100,
      length: 1000,
      getChannelData: () => new Float32Array(1000).fill(0.1)
    });
  }
} as any;

globalThis.Worker = class {
  postMessage() {}
  terminate() {}
  onmessage = null;
  onerror = null;
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
} as any;

describe('Audio API Integration Test', () => {
  let canvas: HTMLCanvasElement;
  let audioElement: HTMLMediaElement;
  let mockEffect: Effect;
  
  beforeEach(() => {
    canvas = document.createElement('canvas');
    audioElement = document.createElement('audio');

    mockEffect = {
      init: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn(),
      frame: vi.fn(),
      update: vi.fn(),
      destroy: vi.fn()
    };
  });
  
  it('should create an instance of Audio', () => {
    const audio = new Audio({ canvas });
    expect(audio).toBeInstanceOf(Audio);
    
    const audioWithData = new Audio({ canvas, data: audioElement });
    expect(audioWithData['options'].data).toBe(audioElement);
    
    const audioWithEffect = new Audio({ canvas, effect: mockEffect });
    expect(audioWithEffect['options'].effect).toBe(mockEffect);
    expect(mockEffect.init).toHaveBeenCalledWith(canvas);
  });

  it('should set the audio data', () => {
    const audio = new Audio({ canvas });
    const result = audio.data(audioElement);
    
    expect(result).toBe(audio);
    expect(audio['options'].data).toBe(audioElement);
    expect(audio['analyser']).toBeDefined();
  });
  
  it('should set the effect', async () => {
    const audio = new Audio({ canvas });
    const result = audio.effect(mockEffect);
    
    expect(result).toBe(audio);
    expect(audio['options'].effect).toBe(mockEffect);
    expect(mockEffect.init).toHaveBeenCalledWith(canvas);
    
    const newEffect: Effect = {
      init: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn(),
      frame: vi.fn(),
      update: vi.fn(),
      destroy: vi.fn()
    };
    
    audio.effect(newEffect);
    expect(mockEffect.destroy).toHaveBeenCalled();
    expect(audio['options'].effect).toBe(newEffect);
  });
  
  it('should update the effect style', () => {
    const audio = new Audio({ canvas, effect: mockEffect });
    const options = { exposure: 0.3 };
    const result = audio.style(options);
    
    expect(result).toBe(audio);
    expect(mockEffect.update).toHaveBeenCalledWith(options);
  });
  
  it('should play the audio and animation', async () => {
    const audio = new Audio({ canvas, effect: mockEffect });
    
    let frameCallCount = 0;
    audio.onframe = () => { frameCallCount++; };
    
    await audio.play();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(audio['timer']).toBeDefined();
    expect(frameCallCount).toBeGreaterThan(0);
    expect(mockEffect.frame).toHaveBeenCalled();
  });
  
  it('should resize the canvas', () => {
    const audio = new Audio({ canvas, effect: mockEffect });
    audio.resize(800, 600);
    
    expect(canvas.width).toBe(800 * window.devicePixelRatio);
    expect(canvas.height).toBe(600 * window.devicePixelRatio);
    
    expect(mockEffect.resize).toHaveBeenCalledWith(
      canvas.width,
      canvas.height
    );
  });
  
  it('should clean up resources', () => {
    const mockDisconnect = vi.fn();
    const audio = new Audio({ canvas, effect: mockEffect });
    audio['analyser'] = { disconnect: mockDisconnect } as any;
    audio['timer'] = 111;
    
    audio.destroy();
    expect(mockEffect.destroy).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });
  
  it('should classify the genre of the audio', async () => {
    const audio = new Audio({ canvas });
    audio.classifyGenre = () => Promise.resolve({
      classifyLabel: 'rock',
      classifyTime: 123,
      classifyOutput: 4
    });

    const file = new File(['dummy'], 'test.mp3', { type: 'audio/mp3' });
    const fileList = { 0: file, length: 1 } as unknown as FileList;
    const result = await audio.classifyGenre(fileList);
    expect(result).toEqual({
      classifyLabel: 'rock',
      classifyTime: 123,
      classifyOutput: 4
    });
  });
});