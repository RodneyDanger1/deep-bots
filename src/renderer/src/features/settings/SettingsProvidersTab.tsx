import { Button, Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle, Plug } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { activeServerHasProviderSettings } from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";

/**
 * The entry of the personal settings to the provider page of the active server.
 *
 * Providers belong to the computer that runs the agents: the page that downloads a CLI, connects
 * an account or signs one out is the Providers section of that server's settings. This tab names
 * that page, says which computer it belongs to, and opens it in one press. A member who cannot
 * administer the host gets the reason, not a button that does nothing.
 */
export function SettingsProvidersTab() {
  const i18n = useText();
  const { activeServer } = useServers();
  const { openServerSettings } = useServerSettings();
  /** The active server whose providers this account can manage, or undefined. */
  const manageable = () => {
    const server = activeServer();
    return server && activeServerHasProviderSettings(server) ? server : undefined;
  };
  /** What this account can do with the providers of the active server. */
  const sentence = (): string => {
    const server = activeServer();
    if (!server) return i18n.t("settings.providers.noServer");
    if (!activeServerHasProviderSettings(server))
      return i18n.t("settings.providers.managedByHost", { name: server.name });
    return i18n.t("settings.providers.open.description", { name: server.name });
  };
  const openProviders = (trigger: HTMLElement): void => {
    const server = manageable();
    if (server) openServerSettings(server.id, trigger, "providers");
  };
  return (
    <ItemGroup class="settings-modal-card">
      <Item data-settings-row="settings.providers.open.title" class="settings-modal-row">
        <ItemContent>
          <ItemTitle>{i18n.t("settings.providers.open.title")}</ItemTitle>
          <ItemDescription>{sentence()}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!manageable()}
            onClick={(event) => openProviders(event.currentTarget)}
          >
            <Plug aria-hidden="true" />
            {i18n.t("settings.providers.open.action")}
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  );
}
