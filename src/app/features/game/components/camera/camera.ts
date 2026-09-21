import {
  Component,
  DestroyRef,
  afterNextRender,
  afterRenderEffect,
  inject,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { LocaleService } from '@core/i18n/locale.service';
import { VISION_MODEL } from '@core/webllm/data/llm-models';
import { log } from '@core/logger/logger';

/** The shape the eye can take in one look: see `VISION_MODEL.frame`. */
const FRAME = VISION_MODEL.frame;
const FRAME_RATIO = FRAME.width / FRAME.height;

/** A live preview and a shutter. It hands back one photo; it knows nothing about models. */
@Component({
  selector: 'mb-camera',
  templateUrl: './camera.html',
  styleUrl: './camera.scss',
})
export class Camera {
  /** The photo, as a JPEG `data:` URL. */
  readonly captured = output<string>();
  readonly cancelled = output<void>();

  private readonly locale = inject(LocaleService);
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly shutter = viewChild.required<ElementRef<HTMLButtonElement>>('shutter');
  private stream: MediaStream | null = null;

  protected readonly t = this.locale.t;
  protected readonly live = signal(false);
  protected readonly unavailable = signal(false);

  constructor() {
    // The camera light must go out the moment this leaves the screen, however it leaves.
    inject(DestroyRef).onDestroy(() => this.stop());
    afterNextRender(() => void this.start());

    // Enter takes the photo, the same key that conjures. This waits for the
    // render because the shutter is disabled until the stream is live, and a
    // disabled button silently refuses focus.
    afterRenderEffect(() => {
      if (this.live()) {
        this.shutter().nativeElement.focus();
      }
    });
  }

  /**
   * Cuts the largest centred rectangle of the eye's shape out of the current
   * frame and scales it to the eye's size. The centre, because that is where
   * people hold things up.
   */
  protected capture(): void {
    const video = this.video().nativeElement;

    if (!this.live() || video.videoWidth === 0) {
      return;
    }

    const { videoWidth: w, videoHeight: h } = video;
    const cutWidth = w / h >= FRAME_RATIO ? h * FRAME_RATIO : w;
    const cutHeight = cutWidth / FRAME_RATIO;

    const canvas = document.createElement('canvas');
    canvas.width = FRAME.width;
    canvas.height = FRAME.height;
    canvas
      .getContext('2d')
      ?.drawImage(
        video,
        (w - cutWidth) / 2,
        (h - cutHeight) / 2,
        cutWidth,
        cutHeight,
        0,
        0,
        FRAME.width,
        FRAME.height,
      );

    const photo = canvas.toDataURL('image/jpeg', 0.85);
    log.group(
      'camera',
      `photo · ${FRAME.width}×${FRAME.height} · ${Math.round((photo.length * 0.75) / 1024)} KB`,
      () => {
        console.log(
          `cut ${Math.round(cutWidth)}×${Math.round(cutHeight)} from the centre of a ${w}×${h} frame`,
        );
        // Shown in the console as an image: open the group to see exactly what the eye was sent.
        console.log(
          '%c ',
          `font-size:1px; padding:${FRAME.height / 4}px ${FRAME.width / 4}px; background:url(${photo}) center/contain no-repeat`,
        );
      },
    );
    this.captured.emit(photo);
  }

  private async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      const video = this.video().nativeElement;
      video.srcObject = this.stream;
      await video.play();

      this.live.set(true);
      const track = this.stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      log.info(
        'camera',
        `on · ${track?.label || 'unnamed device'} · ${settings?.width}×${settings?.height}`,
      );
    } catch (cause) {
      log.warn(
        'camera',
        'could not start',
        cause instanceof DOMException ? `${cause.name}: ${cause.message}` : cause,
      );
      // Refused, absent, or taken by another tab: the typed path still works.
      this.stop();
      this.unavailable.set(true);
    }
  }

  private stop(): void {
    if (this.stream) {
      log.info('camera', 'off');
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
