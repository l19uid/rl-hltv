(function (root) {
  const WEIGHTS = { goals: 0.25, assists: 0.15, saves: 0.2, shots: 0.1, demos: 0.05, score: 0.25 };

  function composite(perGame, means) {
    let sum = 0, used = 0;
    for (const k in WEIGHTS) {
      const v = perGame[k];
      if (v == null || !means[k]) continue;
      sum += WEIGHTS[k] * v / means[k];
      used += WEIGHTS[k];
    }
    return used ? sum / used : null;
  }

  const toRating = (c, mu, sigma) => Math.max(0, 1 + 0.25 * (c - mu) / (sigma || 1));

  function band(r) {
    return r >= 1.5 ? "amazing" : r >= 1 ? "great" : r >= 0.5 ? "low" : "awful";
  }

  const api = { WEIGHTS, composite, toRating, band };
  root.PlayerRating = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
