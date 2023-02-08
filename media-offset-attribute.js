import { mediaOffset } from './media-offset.js';

const mediaOffsets = new WeakMap();
const observer = new MutationObserver(mutationCallback);

function mutationCallback(mutationsList) {
  for (let mutation of mutationsList) {
    if (mutation.type === 'childList') {
      mutation.removedNodes.forEach(toggleMediaOffset);
      mutation.addedNodes.forEach(toggleMediaOffset);
    } else if (mutation.type === 'attributes') {
      if (mutation.attributeName.startsWith('data-offset')) {
        toggleMediaOffset(mutation.target);
      }
    }
  }
}

observer.observe(document, {
  attributes: true,
  attributeFilter: ['data-offset', 'data-offset-shim', 'data-offset-media'],
  attributeOldValue: true,
  childList: true,
  subtree: true,
});

document.querySelectorAll('[data-offset]')
  .forEach(toggleMediaOffset);

async function toggleMediaOffset(target) {
  if (target.localName?.includes('-')) {
    await customElements.whenDefined(target.localName);
  }

  const objPath = target.dataset?.offsetMedia;
  const media = objPath ? objPath.split('.').reduce((o, i) => o[i], target) : target;

  if (!isMediaElement(media)) return;

  if ('offset' in target.dataset) {

    const options = mediaOffsetOptions(target.dataset);
    const mo = mediaOffsets.get(media);
    if (mo) {
      mo.shim = options.shim;
      mo.start = options.start;
      mo.end = options.end;
      return;
    }

    mediaOffsets.set(media, mediaOffset(media, options));
    return;
  }

  mediaOffsets.get(media)?.destroy();
}

function isMediaElement(node) {
  return (
    node instanceof HTMLMediaElement ||
    node.localName?.endsWith('video') ||
    node.localName?.endsWith('audio') ||
    node.localName?.endsWith('player')
  );
}

function mediaOffsetOptions({ offset, offsetShim }) {
  if (!offset) {
    return {
      start: 0,
      end: undefined,
      shim: offsetShim != null
    };
  }

  const [start, end] = offset.split(/\s+/);
  return {
    start: +start,
    end: end == null ? undefined : +end,
    shim: offsetShim != null
  };
}
