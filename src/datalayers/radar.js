import { UrlTemplateImageryProvider } from 'cesium';
import { BaseLayer } from './BaseLayer';

const INDEX = 'https://api.rainviewer.com/public/weather-maps.json';

/** Precipitation radar mosaic from RainViewer (latest frame, refreshed every 10 min). */
class RadarLayer extends BaseLayer {
  constructor(viewer, ctx) {
    super(viewer, ctx, { opacity: '0.7' });
    this.layer = null;
    this.every(10 * 60e3, () => this.load());
  }

  async load() {
    const res = await fetch(INDEX, { signal: this.abort.signal });
    if (!res.ok) throw new Error(`RainViewer ${res.status}`);
    const data = await res.json();
    const frame = data.radar?.past?.[data.radar.past.length - 1];
    if (!frame) throw new Error('No radar frame');
    if (this.frameTime === frame.time) return;
    this.frameTime = frame.time;
    const provider = new UrlTemplateImageryProvider({
      url: `${data.host}${frame.path}/256/{z}/{x}/{y}/4/1_1.png`,
      maximumLevel: 7,
      credit: 'RainViewer',
    });
    const layers = this.viewer.imageryLayers;
    if (this.layer) layers.remove(this.layer);
    this.layer = layers.addImageryProvider(provider);
    this.layer.alpha = Number(this.options.opacity);
    this.message = `Frame ${new Date(frame.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    this.setStatus('ok', this.message);
    this.render();
  }

  onOptions() {
    if (this.layer) this.layer.alpha = Number(this.options.opacity);
    this.render();
  }

  optionSchema() {
    return [
      {
        key: 'opacity',
        label: 'Opacity',
        choices: [{ value: '0.4', label: '40%' }, { value: '0.7', label: '70%' }, { value: '1', label: '100%' }],
      },
    ];
  }

  dispose() {
    if (this.layer) this.viewer.imageryLayers.remove(this.layer);
  }
}

export default {
  id: 'radar',
  name: 'Rain radar',
  group: 'Weather',
  icon: '🌧️',
  note: 'RainViewer global radar mosaic. Coverage depends on national radar networks.',
  create: (viewer, ctx) => new RadarLayer(viewer, ctx),
};
