
const mediaState = new WeakMap();
const observer = new MutationObserver(mutationCallback);

function mutationCallback(mutationsList) {
  for (let mutation of mutationsList) {
    if (mutation.type === 'childList') {
      mutation.removedNodes.forEach(toggleMediaOffset);
      mutation.addedNodes.forEach(toggleMediaOffset);
    } else if (mutation.type === 'attributes') {
      if (mutation.attributeName === 'data-offset') {
        toggleMediaOffset(mutation.target);
      }
    }
  }
}

observer.observe(document, {
  attributes: true,
  attributeFilter: ['data-offset', 'data-offset-media'],
  attributeOldValue: true,
  childList: true,
  subtree: true,
});

document.querySelectorAll(`[${'data-offset'}]`)
  .forEach(toggleMediaOffset);


async function toggleMediaOffset(target) {
  if (target.localName?.includes('-')) {
    await customElements.whenDefined(target.localName);
  }

  const objPath = target.getAttribute?.('data-offset-media');
  const media = objPath ? objPath.split('.').reduce((o, i) => o[i], target) : target;

  if (!isMediaElement(media)) return;

  mediaState.set(media, {
    getOffsetAttribute: () => target.getAttribute('data-offset')
  });

  if (target.getAttribute('data-offset')) {
    addMediaOffset(media);
    return;
  }

  removeMediaOffset(media);
}

function isMediaElement(node) {
  return (
    node instanceof HTMLMediaElement ||
    node.localName?.endsWith('video') ||
    node.localName?.endsWith('audio') ||
    node.localName?.endsWith('player')
  );
}

function mediaOffset(media) {
  const val = mediaState.get(media).getOffsetAttribute();

  if (!val) {
    return { start: 0, end: undefined };
  }

  const [start, end] = val.split(/\s+/);
  return { start: +start, end: end == null ? undefined : +end };
}

function onSeeking({ currentTarget: media }) {
  if (media.currentTime < 0) {
    media.currentTime = 0;
  }

  if (media.currentTime > media.duration) {
    media.currentTime = media.duration;
  }
}

function onTimeupdate({ currentTarget: media }) {
  const { currentTime, duration, ended } = media;
  const offset = mediaOffset(media);

  clearInterval(mediaState.get(media).interval);

  if (offset.start > 0 && currentTime < 0) {
    media.currentTime = 0;
    return;
  }

  if (offset.end == null) return;

  if (ended) {

    if (media.loop) {
      media.currentTime = 0;
      return;
    }

    media.pause();
    media.dispatchEvent(new Event('ended'));

    return;
  }

  // When the playhead is 200ms or less from the end check every 10ms
  // for increased accuracy. timeupdate is only fired every ~150ms or so.
  if (currentTime + .2 > duration) {
    const interval = setInterval(onTimeupdate, 10, { currentTarget: media });
    mediaState.get(media).interval = interval;
  }
}

function onPlaying({ currentTarget: media }) {
  const { ended } = media;

  if (ended) {
    media.currentTime = 0;
  }
}

function addMediaOffset(media) {
  let { descriptors } = mediaState.get(media);
  if (!descriptors) {
    descriptors = mediaState.get(media).descriptors = {};

    const oldCurrentTime = media.currentTime;

    media.addEventListener('timeupdate', onTimeupdate);
    media.addEventListener('seeking', onSeeking);
    media.addEventListener('playing', onPlaying);

    // Patch the media instance, not the prototype.
    // Restore original descriptors if the offset attribute is removed.
    if ('currentTime' in media) {
      const currentTime = getDescriptor(media, 'currentTime');
      descriptors.currentTime = currentTime;

      Object.defineProperty(media, 'currentTime', {
        configurable: true,
        get() {
          return currentTime.get.call(media) - mediaOffset(media).start;
        },
        set(seconds) {
          currentTime.set.call(media, +seconds + mediaOffset(media).start);
        },
      });
    }

    if ('duration' in media) {
      const duration = getDescriptor(media, 'duration');
      descriptors.duration = duration;

      Object.defineProperty(media, 'duration', {
        configurable: true,
        get() {
          const offset = mediaOffset(media);
          if (offset.end > 0) {
            return offset.end - offset.start;
          }
          return duration.get.call(media) - offset.start;
        },
      });
    }

    if ('currentTime' in media && 'duration' in media) {
      descriptors.ended = getDescriptor(media, 'ended');

      Object.defineProperty(media, 'ended', {
        configurable: true,
        get() {
          return media.currentTime >= media.duration;
        },
      });
    }

    if ('seekable' in media) {
      descriptors.seekable = getDescriptor(media, 'seekable');

      Object.defineProperty(media, 'seekable', {
        configurable: true,
        get: createGetRanges(media, descriptors.seekable),
      });
    }

    if ('buffered' in media) {
      descriptors.buffered = getDescriptor(media, 'buffered');

      Object.defineProperty(media, 'buffered', {
        configurable: true,
        get: createGetRanges(media, descriptors.buffered),
      });
    }

    if ('played' in media) {
      descriptors.played = getDescriptor(media, 'played');

      Object.defineProperty(media, 'played', {
        configurable: true,
        get: createGetRanges(media, descriptors.played),
      });
    }

    media.dispatchEvent(new Event('durationchange'));
    media.dispatchEvent(new Event('progress'));
    media.currentTime = oldCurrentTime;
  }
}

function createGetRanges(media, descriptor) {
  return function() {
    const offset = mediaOffset(media);
    const orig = descriptor.get.call(media);
    const ranges = [];

    for (let i = 0; i < orig.length; i++) {
      ranges[i] = [
        Math.max(0, orig.start(i) - offset.start),
        Math.min(Math.max(0, orig.end(i) - offset.start), media.duration)
      ];
    }

    return createTimeRanges(ranges);
  }
}

function removeMediaOffset(media) {
  let state = mediaState.get(media);
  if (state) {
    mediaState.delete(media);

    media.removeEventListener('timeupdate', onTimeupdate);
    media.removeEventListener('seeking', onSeeking);
    media.removeEventListener('playing', onPlaying);

    for (let prop in state.descriptors) {
      Object.defineProperty(media, prop, state.descriptors[prop]);
    }

    media.dispatchEvent(new Event('durationchange'));
    media.dispatchEvent(new Event('progress'));
    media.dispatchEvent(new Event('timeupdate'));
  }
}

function getDescriptor(obj, prop) {
  for (
    let proto = obj;
    proto && proto !== HTMLElement.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    if (descriptor) return descriptor;
  }
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
