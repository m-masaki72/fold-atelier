export function createCollectionHistory() {
  const visited = new Set();
  let history = [];
  let historyIndex = -1;

  function canGoBack(current) {
    return historyIndex >= 0 && (current !== history[historyIndex] || historyIndex > 0);
  }

  return {
    visited,
    canGoBack,
    record(id) {
      visited.add(id);
      history.splice(historyIndex + 1);
      history.push(id);
      historyIndex = history.length - 1;
    },
    previous(current) {
      if (!canGoBack(current)) return null;
      if (current === history[historyIndex]) historyIndex--;
      return history[historyIndex];
    },
    restore(saved) {
      visited.clear();
      saved.visited.forEach((id) => visited.add(id));
      history = [...saved.history];
      historyIndex = saved.historyIndex;
    },
    snapshot: () => ({ visited: [...visited], history: [...history], historyIndex }),
  };
}
