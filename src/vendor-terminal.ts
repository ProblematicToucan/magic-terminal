import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

(window as any).Terminal = Terminal;
(window as any).FitAddon = FitAddon;
(window as any).WebLinksAddon = WebLinksAddon;
