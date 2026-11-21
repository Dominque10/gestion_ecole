// Saisie masquée au clavier pour les scripts (mot de passe jamais affiché ni gardé dans l'historique).

const ENTER = ["\r", "\n"];
const CTRL_C = "\u0003";
const BACKSPACE = ["\b", "\u007f"];

/** Lit une saisie au clavier sans l'afficher (une étoile par caractère). */
export function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (ENTER.includes(char)) {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === CTRL_C) process.exit(130);
        if (BACKSPACE.includes(char)) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          value += char;
          process.stdout.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
}
