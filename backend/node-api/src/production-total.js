'use strict';

// Contadores do CLP são inteiros e não podem ser negativos. Qualquer valor
// inválido é tratado como zero para não corromper o acumulado.
function toCounter(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

// O contador da linha zera a cada reset. O acumulado da PI40 nunca deve
// diminuir: quando o contador atual é menor que o anterior, registramos o
// reset e seguimos sem somar nada. Os deltas voltam a contar a partir do novo
// contador na amostra seguinte.
function computeProductionTotal(previous, current) {
  const produced = toCounter(current?.produced);
  const good = toCounter(current?.good);

  if (!previous) {
    return {
      accumulatedProduced: produced,
      accumulatedGood: good,
      lastCounter: produced,
      lastGoodCounter: good,
      lastResetAt: null,
      reset: false,
    };
  }

  const lastProduced = toCounter(previous.lastCounter);
  const lastGood = toCounter(previous.lastGoodCounter);
  const reset = produced < lastProduced || good < lastGood;

  return {
    accumulatedProduced:
      toCounter(previous.accumulatedProduced) +
      (reset ? 0 : produced - lastProduced),
    accumulatedGood:
      toCounter(previous.accumulatedGood) + (reset ? 0 : good - lastGood),
    lastCounter: produced,
    lastGoodCounter: good,
    lastResetAt: reset
      ? current?.timestamp ?? null
      : previous.lastResetAt ?? null,
    reset,
  };
}

module.exports = {
  computeProductionTotal,
  toCounter,
};
