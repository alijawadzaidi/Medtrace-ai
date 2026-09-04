import { defineRailway, github, mysql, preserve, project, service, volume } from "railway/iac";

/**
 * The MedTrace project, defined in code.
 *
 * Every service builds from its own subdirectory of one repository, using the
 * Dockerfile that lives there. `rootDirectory` is what makes that work: without
 * it Railway inspects the repository root, finds four language ecosystems side
 * by side, and cannot decide what to build.
 *
 * Secrets are `preserve()`d rather than written here — the values stay in
 * Railway and never reach source control.
 */
const REPO = "alijawadzaidi/Medtrace-ai";
const BRANCH = "main";

export default defineRailway(() => {
  const MySQL = mysql("MySQL", { region: "iad" });
  MySQL.deploy = {
    startCommand:
      "docker-entrypoint.sh mysqld --innodb-use-native-aio=0 --disable-log-bin --performance_schema=0 --innodb-buffer-pool-size=1G",
  };
  MySQL.networking = { privateNetworkEndpoint: "mysql" };

  const mysqlVolume = volume("mysql-volume", {
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
    allowOnlineResize: true,
    region: "iad",
    sizeMB: 500,
  });

  /**
   * The API is the only service with database credentials, and the only one
   * that runs migrations. `preDeploy` runs before the new version takes
   * traffic, so a release that cannot migrate never serves a request.
   */
  const medtraceApi = service("medtrace-api", {
    source: github(REPO, { branch: BRANCH, rootDirectory: "api" }),
    // Explicit, because Railway's auto-detection ignores a Dockerfile it was
    // not told about: the first build here used Railpack and produced an
    // image that skipped everything the Dockerfile does, including generating
    // the OpenAPI document that /docs serves.
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "npx sequelize-cli db:migrate --env production",
    replicas: { iad: 1 },
    env: {
      AI_SERVICE_URL: preserve(),
      BCRYPT_ROUNDS: preserve(),
      CORS_ORIGIN: preserve(),
      DB_DIALECT: preserve(),
      DB_HOST: preserve(),
      DB_NAME: preserve(),
      DB_PASSWORD: preserve(),
      DB_PORT: preserve(),
      DB_USER: preserve(),
      DEMO_PASSWORD: preserve(),
      JWT_EXPIRES_IN: preserve(),
      JWT_SECRET: preserve(),
      NODE_ENV: preserve(),
      PORT: preserve(),
      VERIFY_BASE_URL: preserve(),
    },
  });

  /**
   * Stateless by design: it receives features and returns a score, holds no
   * data, and needs no credentials. Losing it costs the risk score and nothing
   * else, which is why it has no dependency on the database at all.
   */
  const medtraceAi = service("medtrace-ai", {
    source: github(REPO, { branch: BRANCH, rootDirectory: "ai" }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { iad: 1 },
    env: { PORT: preserve() },
  });

  /**
   * NEXT_PUBLIC_API_URL is inlined into the client bundle during the build, so
   * it must be present as a service variable *before* the image is built — it
   * is read at build time, not at runtime.
   */
  const medtraceWeb = service("medtrace-web", {
    source: github(REPO, { branch: BRANCH, rootDirectory: "web" }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/",
    healthcheckTimeout: 30,
    replicas: { iad: 1 },
    env: { NEXT_PUBLIC_API_URL: preserve(), PORT: preserve() },
  });

  return project("medtrace", {
    resources: [MySQL, mysqlVolume, medtraceApi, medtraceAi, medtraceWeb],
  });
});
