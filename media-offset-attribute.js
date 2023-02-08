import { mediaOffset } from './media-offset.js';

const mediaOffsets = new WeakMap();
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

  if (target.getAttribute('data-offset')) {

    const options = mediaOffsetOptions(target.getAttribute('data-offset'));
    const mo = mediaOffsets.get(media);
    if (mo) {
      mo.start = options.start;
      mo.end = options.end;
      return;
    }

    console.log(99, media, options);

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

function mediaOffsetOptions(val) {
  if (!val) return { start: 0, end: undefined };

  const [start, end] = val.split(/\s+/);
  return { start: +start, end: end == null ? undefined : +end };
}
