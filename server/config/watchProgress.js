const DEFAULT_COMPLETION_PERCENT = 95;
const configuredPercent = process.env.WATCH_COMPLETION_PERCENT;
const completionPercent = configuredPercent === undefined || configuredPercent.trim() === ""
  ? DEFAULT_COMPLETION_PERCENT
  : Number(configuredPercent);

if (!Number.isInteger(completionPercent) || completionPercent < 1 || completionPercent > 100) {
  throw new Error("WATCH_COMPLETION_PERCENT must be a whole number between 1 and 100.");
}

module.exports = {
  completionPercent,
  completionRatio: completionPercent / 100,
};
