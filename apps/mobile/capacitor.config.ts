import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The native shells bundle the web build and ask for the OmniCloud server on
 * first launch. Nothing is loaded from a remote URL: the WebView always runs
 * the bundled assets, and API calls go to the origin stored on the device.
 */
const config: CapacitorConfig = {
  appId: "com.hilbras.omnicloud",
  appName: "OmniCloud",
  webDir: "../web/dist",
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
