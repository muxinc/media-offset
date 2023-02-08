
export function mediaOffset(media, options) {
  const mo = new MediaOffset(media);
  mo.shim = options.shim;
  mo.start = options.start;
  mo.end = options.end;
  return mo;
}

export class MediaOffset {
  #media;
  #initialTime;
  #timeInterval;
  #shim;
  #start;
  #end;

  constructor(media) {
    this.#media = media;
    media.addEventListener('durationchange', this.#seekInSeekableRange);
    media.addEventListener('timeupdate', this.#onTimeupdate);
    media.addEventListener('seeking', this.#seekInSeekableRange);
    media.addEventListener('playing', this.#onPlaying);
  }

  destroy() {
    const media = this.#media;
    media.removeEventListener('durationchange', this.#seekInSeekableRange);
    media.removeEventListener('timeupdate', this.#onTimeupdate);
    media.removeEventListener('seeking', this.#seekInSeekableRange);
    media.removeEventListener('playing', this.#onPlaying);

    this.shim = false;
  }

  #seekInSeekableRange = () => {
    const media = this.#media;
    if (media.readyState === 0) return;

    // Setting preload to `none` from `auto` was required on iOS to fix a bug
    // that caused no `timeupdate` events to fire after seeking ¯\_(ツ)_/¯
    const wasAuto = media.preload === 'auto';
    if (wasAuto) {
      media.preload = 'none';
    }

    if (this.currentTime < 0) {
      this.currentTime = 0;
    }

    if (this.currentTime > this.duration) {
      this.currentTime = this.duration;
    }

    if (wasAuto) {
      media.preload = 'auto';
    }
  }

  #onTimeupdate = () => {
    const media = this.#media;
    const { currentTime, duration, ended } = this;

    clearInterval(this.#timeInterval);

    if (this.start > 0 && currentTime < 0) {
      this.currentTime = 0;
      return;
    }

    if (this.end == null) return;

    if (ended) {

      if (media.loop) {
        this.currentTime = 0;
        return;
      }

      media.pause();
      media.dispatchEvent(new Event('ended'));

      return;
    }

    // When the playhead is 200ms or less from the end check every 10ms
    // for increased accuracy. timeupdate is only fired every ~150ms or so.
    if (currentTime + .2 > duration) {
      this.#timeInterval = setInterval(this.#onTimeupdate, 10);
    }
  }

  #onPlaying = () => {
    if (this.ended) {
      this.currentTime = 0;
    }
  }

  get shim() {
    return this.#shim;
  }

  set shim(val) {
    this.#shim = val;
    const media = this.#media;

    if (val) {
      // Patch the media instance, not the prototype.
      // Restore original descriptors if the offset-shim attribute is removed.

      Object.defineProperty(media, 'currentTime', {
        configurable: true,
        get: () => this.currentTime,
        set: (val) => { this.currentTime = val }
      });

      Object.defineProperty(media, 'duration', {
        configurable: true,
        get: () => this.duration,
      });

      Object.defineProperty(media, 'ended', {
        configurable: true,
        get: () => this.ended,
      });

      if ('seekable' in media) {
        Object.defineProperty(media, 'seekable', {
          configurable: true,
          get: () => this.seekable,
        });
      }

      if ('buffered' in media) {
        Object.defineProperty(media, 'buffered', {
          configurable: true,
          get: () => this.buffered,
        });
      }

      if ('played' in media) {
        Object.defineProperty(media, 'played', {
          configurable: true,
          get: () => this.played,
        });
      }

    } else {

      delete media.currentTime;
      delete media.duration;
      delete media.ended;
      delete media.seekable;
      delete media.buffered;
      delete media.played;
    }
  }

  get start() {
    return this.#start;
  }

  set start(val) {
    this.#start = +val;
    this.#seekInSeekableRange();
  }

  get end() {
    return this.#end;
  }

  set end(val) {
    this.#end = +val;
    this.#seekInSeekableRange();
  }

  get currentTime() {
    return getNative(this.#media, 'currentTime') - this.start;
  }

  set currentTime(val) {
    setNative(this.#media, 'currentTime', +val + this.start);
  }

  get duration() {
    if (this.end > 0) {
      return this.end - this.start;
    }
    return getNative(this.#media, 'duration') - this.start;
  }

  get ended() {
    return this.currentTime >= this.duration;
  }

  get seekable() {
    return getRanges(getNative(this.#media, 'seekable'), this.start, this.duration);
  }

  get buffered() {
    return getRanges(getNative(this.#media, 'buffered'), this.start, this.duration);
  }

  get played() {
    return getRanges(getNative(this.#media, 'played'), this.start, this.duration);
  }
}

function getNative(obj, prop) {
  return getDescriptor(obj, prop).get.call(obj);
}

function setNative(obj, prop, val) {
  return getDescriptor(obj, prop).set.call(obj, val);
}

export function getDescriptor(obj, prop) {
  for (
    let proto = Object.getPrototypeOf(obj);
    proto && proto !== HTMLElement.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    if (descriptor) return descriptor;
  }
}

function getRanges(orig, start, duration) {
  const ranges = [];

  for (let i = 0; i < orig.length; i++) {
    ranges[i] = [
      Math.max(0, orig.start(i) - start),
      Math.min(Math.max(0, orig.end(i) - start), duration)
    ];
  }

  return createTimeRanges(ranges);
}

/**
 * Creates a fake `TimeRanges` object.
 *
 * A TimeRanges object. This object is normalized, which means that ranges are
 * ordered, don't overlap, aren't empty, and don't touch (adjacent ranges are
 * folded into one bigger range).
 *
 * @param  {(Number|Array)} Start of a single range or an array of ranges
 * @param  {Number} End of a single range
 * @return {Array}
 */
function createTimeRanges(start, end) {
  if (Array.isArray(start)) {
    return createTimeRangesObj(start);
  } else if (start == null || end == null || (start === 0 && end === 0)) {
    return createTimeRangesObj([[0, 0]]);
  }
  return createTimeRangesObj([[start, end]]);
}

function createTimeRangesObj(ranges) {
  Object.defineProperties(ranges, {
    start: {
      value: i => ranges[i][0]
    },
    end: {
      value: i => ranges[i][1]
    }
  });
  return ranges;
}
