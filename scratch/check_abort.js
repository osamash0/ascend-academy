console.log('globalThis.AbortController:', globalThis.AbortController);
console.log('AbortController:', AbortController);
try {
  new Request('http://a', { signal: new AbortController().signal });
  console.log('Native Request OK');
} catch (e) {
  console.log('Native Request FAIL:', e.message);
}
