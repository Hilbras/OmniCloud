import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The native shells load one OmniCloud server. Same-origin keeps session
 * cookies, range requests and share pages identical to the browser; the
 * bundled web build is the offline fallback.
 */
const serverUrl = (process.env.MOBILE_SERVER_URL ?? "").trim();

if (serverUrl === "" && process.env.CI !== "true") {
  console.warn(
    "[omnicloud-mobile] MOBILE_SERVER_URL is empty: the app will load the bundled web build, whose /api calls have no server. Set it to your instance origin.",
  );
}

const parsed = serverUrl === "" ? null : new URL(serverUrl);

const config: CapacitorConfig = {
  appId: "com.hilbras.omnicloud",
  appName: "OmniCloud",
  webDir: "../web/dist",
  server:
    parsed === null
      ? {}
      : {
          url: serverUrl,
          cleartext: parsed.protocol === "http:",
          allowNavigation: [parsed.host],
        },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: "#0b0b0c",
      showSpinner: false,
      androidSplashResourceName: "splash",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b0b0c",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: "always",
  },
};

export default config;
