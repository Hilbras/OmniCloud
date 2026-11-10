/**
 * WebDAV server configuration.
 *
 * Reads from the main AppConfig so all configuration stays in one place.
 */

export interface WebDavConfig {
  enabled: boolean;
  host: string;
  port: number;
  writeEnabled: boolean;
}

export interface AppConfig {
  webDavEnabled: boolean;
  webDavHost: string;
  webDavPort: number;
  webDavWriteEnabled: boolean;
}

export function loadWebDavConfig(config: AppConfig): WebDavConfig {
  return {
    enabled: config.webDavEnabled,
    host: config.webDavHost,
    port: config.webDavPort,
    writeEnabled: config.webDavWriteEnabled,
  };
}
