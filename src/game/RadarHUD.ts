import type { RadarBlip } from './types';

export class RadarHUD {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 260;
  private height = 148;
  private accentRgb = '56, 189, 248';

  public setAccentRgb(rgb: string): void {
    this.accentRgb = rgb;
  }

  public attachCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    if (!canvas) {
      this.ctx = null;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = 264;
    this.height = 148;
    canvas.width = Math.round(this.width * dpr);
    canvas.height = Math.round(this.height * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx = ctx;
    }
  }

  public render(blips: RadarBlip[], lockedId: string | null): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2 + 4;
    const rx = 112;
    const ry = 54; // 3D tilted perspective ellipse ratio

    ctx.clearRect(0, 0, w, h);

    // Outer subtle scanner glow disc
    const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, rx);
    grad.addColorStop(0, `rgba(${this.accentRgb}, 0.14)`);
    grad.addColorStop(0.7, 'rgba(15, 23, 42, 0.36)');
    grad.addColorStop(1, 'rgba(9, 13, 22, 0.08)');

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Concentric range ellipses
    ctx.strokeStyle = `rgba(${this.accentRgb}, 0.36)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.62, ry * 0.62, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${this.accentRgb}, 0.18)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.3, ry * 0.3, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${this.accentRgb}, 0.14)`;
    ctx.stroke();

    // Crosshairs & forward FOV wedge lines
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy);
    ctx.lineTo(cx + rx, cy);
    ctx.moveTo(cx, cy - ry);
    ctx.lineTo(cx, cy + ry);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.stroke();

    // Forward FOV cone
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - rx * 0.48, cy - ry * 0.88);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + rx * 0.48, cy - ry * 0.88);
    ctx.strokeStyle = `rgba(${this.accentRgb}, 0.34)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Center player chevron
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx + 5, cy + 4);
    ctx.lineTo(cx, cy + 2);
    ctx.lineTo(cx - 5, cy + 4);
    ctx.closePath();
    ctx.fillStyle = '#f8fafc';
    ctx.fill();

    // Sort back-to-front by rz so nearer blips layer naturally
    const sorted = [...blips].sort((a, b) => a.rz - b.rz);

    for (const blip of sorted) {
      const baseX = cx + blip.rx * (rx - 10);
      const baseY = cy + blip.rz * (ry - 6);
      const stalkHeight = blip.ry * 26;
      const tipY = baseY - stalkHeight;

      let color = '#fbbf24'; // asteroid amber
      let size = 3;
      if (blip.kind === 'station') {
        color = '#38bdf8';
        size = 5.2;
      } else if (blip.kind === 'bay') {
        color = '#22d3ee';
        size = 4;
      } else if (blip.kind === 'planet') {
        color = '#a78bfa';
        size = 5.4;
      } else if (blip.kind === 'asteroid_belt') {
        color = '#f59e0b';
        size = 4.6;
      } else if (blip.kind === 'shuttle') {
        color = '#7dd3fc';
        size = 2.6;
      } else if (blip.kind === 'canister') {
        color = '#34d399';
        size = 3.2;
      } else if (blip.kind === 'star') {
        color = '#fde047';
        size = 4.6;
      } else if (blip.kind === 'pirate') {
        color = '#f87171';
        size = 4.6;
      }

      // Base ring on the scanner plane
      ctx.beginPath();
      ctx.ellipse(baseX, baseY, 3.2, 1.8, 0, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Vertical elevation stalk
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(baseX, tipY);
      if (blip.ry < 0) {
        ctx.setLineDash([2, 2]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.78;
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.setLineDash([]);

      // Blip head
      ctx.globalAlpha = 1;
      if (blip.kind === 'station' || blip.kind === 'bay') {
        ctx.fillStyle = color;
        ctx.fillRect(baseX - size / 2, tipY - size / 2, size, size);
      } else if (blip.kind === 'planet') {
        ctx.beginPath();
        ctx.arc(baseX, tipY, size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(167, 139, 250, 0.35)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (blip.kind === 'asteroid_belt') {
        ctx.beginPath();
        ctx.setLineDash([2, 2]);
        ctx.arc(baseX, tipY, size, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (blip.kind === 'shuttle') {
        ctx.beginPath();
        ctx.moveTo(baseX, tipY - 3.2);
        ctx.lineTo(baseX + 2.8, tipY + 2.4);
        ctx.lineTo(baseX - 2.8, tipY + 2.4);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      } else if (blip.kind === 'star') {
        ctx.beginPath();
        ctx.arc(baseX, tipY, size + 2.2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(baseX, tipY, size, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      } else if (blip.kind === 'pirate') {
        ctx.beginPath();
        ctx.moveTo(baseX, tipY - size);
        ctx.lineTo(baseX + size, tipY);
        ctx.lineTo(baseX, tipY + size);
        ctx.lineTo(baseX - size, tipY);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fecaca';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(baseX, tipY, size, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }

      // Lock bracket if targeted
      if (lockedId && blip.id === lockedId) {
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(baseX - 7, tipY - 7, 14, 14);
      }
    }
    ctx.globalAlpha = 1;
  }
}
