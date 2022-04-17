// It's the main entry point of the tool

import * as toml from 'std/encoding/toml';
import * as fmt from 'std/fmt/colors';
import { writeAll } from 'std/streams';
import { readLines } from 'std/io';

type TableType = "commands" | "tasks";

interface Command {
    source: string
}

interface Task {
    env: {
        [key: string]: string,
    },
    behaviour: string,
    commands: Array<string>
}

// NOTE: https://eklitzke.org/stdout-buffering
async function pipeFrom(r: Deno.Reader, w: Deno.Writer, detail: string) {
    const encoder = new TextEncoder();

    for await (const line of readLines(r)) {
        const buf = encoder.encode(`[${fmt.bold(fmt.magenta(detail))}]: ${line} \n`);
        writeAll(w, buf);
    }
}

const readPerm = await Deno.permissions.query({name: "read", path: "."});

if (readPerm.state == "denied" || readPerm.state == "prompt") {
    await Deno.permissions.request({name: "read", path: "."});
}

let file: Record<TableType, unknown>;

try {
    const buffer = await Deno.readTextFile("./Taskfile");
    file = toml.parse(buffer);
} catch(error) {
    console.log(`${fmt.bold(fmt.red("Oops"))}: Taskfile reading`);
    console.log(error);
    Deno.exit(5);
}

// requested task
const reqTask = Deno.args[0];

// arguments to the task
const args = Deno.args.length > 1 ? Deno.args.slice(1) : undefined;

const cmds = file.commands as Record<string, Command>;
const tasks = file.tasks as Record<string, Task>;

if (!reqTask) {
    console.log(`${fmt.bold(fmt.red("Oops"))}: no task is requested`);
    console.log(`${fmt.bold(fmt.cyan("Available"))}: \n ${Object.keys(tasks).join("")}`);
    Deno.exit(5);
}

if (reqTask in tasks) {
    console.log(`${fmt.green(fmt.bold("Running"))}: ${reqTask}`);

    const task = tasks[reqTask]; 
    let concat = "";

    if (cmds) {
        for (const name in cmds) {
            const script = cmds[name];

            for (let i = 0; i < task.commands.length; i++) {
                let command = task.commands[i];

                if (command.includes(name)) {
                    command = command.replaceAll(name, `deno run ${script.source}`);

                    task.commands[i] = command;
                    break;
                }
            }
        }
    }

    if (task.commands.length > 1) {
        let symbol;

        switch (task.behaviour) {
            case 'pipeline':
                symbol = ' | ';
                break;
            case 'async':
                symbol = ' & ';
                break;
            case 'inOrder':
                symbol = ' ; ';
                break;
            default:
                console.log(`${fmt.bold(fmt.red("Oops"))}: unknown behaviour: ${task.behaviour}`);
                Deno.exit(5);
        } 

        concat = task.commands.join(symbol); 
    } else {
        concat = task.commands.join();
    }

    if (args) {
        for (const argument of args) {
            concat = concat.replace(/{{}}/m, argument);
        }
    }

    const proc = Deno.run({ cmd: ['fish', '-c', concat], stdout: "piped", env: task.env });
    
    Deno.addSignalListener("SIGTERM", () => {
        proc.kill("SIGTERM");
    });

    Deno.addSignalListener("SIGINT", () => {
        proc.kill("SIGINT");
    })

    pipeFrom(proc.stdout, Deno.stdout, reqTask);

    await proc.status();
    proc.close(); 
} else {
    console.log(`${fmt.bold(fmt.red("Oops"))}: Didn't find task named ${fmt.bold(reqTask)}`)
}