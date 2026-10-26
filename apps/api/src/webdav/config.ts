/**
 * WebDAV server configuration.
 *
 * Reads from the main AppConfig so all configuration stays in one place.
 */

export interface WebDavConfig {
  enabled: boolean;
  port: number;
  writeEnabled: boolean;
}

export interface AppConfig {
  webDavEnabled: boolean;
  webDavPort: number;
  webDavWriteEnabled: boolean;
}

export function loadWebDavConfig(config: AppConfig): WebDavConfig {
  return {
    enabled: config.webDavEnabled,
    port: config.webDavPort,
    writeEnabled: config.webDavWriteEnabled,
  };
}
