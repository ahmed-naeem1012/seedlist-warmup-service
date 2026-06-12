require("dotenv").config();

const enabledEnvironments = new Set(["production", "prod", "prods", "staging"]);
const configuredEnvironments = [process.env.APP_ENV, process.env.NODE_ENV]
    .filter(Boolean);
const enabledEnvironment = configuredEnvironments.find((env) =>
    enabledEnvironments.has(env.toLowerCase())
);
const rollbarEnvironment = enabledEnvironment || configuredEnvironments[0] || "development";
const isRollbarEnabled = Boolean(enabledEnvironment && process.env.ROLLBAR_ACCESS_TOKEN);

const noopRollbar = {
    error: () => {},
    warn: () => {},
    warning: () => {},
    info: () => {},
    log: () => {},
    debug: () => {},
    critical: () => {},
    errorHandler: () => (err, req, res, next) => next(err),
};

if (isRollbarEnabled) {
    const Rollbar = require("rollbar");

    const rollbar = new Rollbar({
        accessToken: process.env.ROLLBAR_ACCESS_TOKEN,
        captureUncaught: true,
        captureUnhandledRejections: true,
        environment: rollbarEnvironment,
    });

    console.log("Rollbar initialized in ENV:", rollbar.options.environment);

    module.exports = rollbar;
} else {
    console.log("Rollbar disabled in ENV:", rollbarEnvironment || "development");
    module.exports = noopRollbar;
}
