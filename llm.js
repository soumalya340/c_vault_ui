import OpenAI from "openai";
import readline from "readline";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey) {
    console.error("Missing NVIDIA_API_KEY in .env");
    process.exit(1);
}

const client = new OpenAI({
    apiKey,
    baseURL: 'https://integrate.api.nvidia.com/v1',
})

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function ask(question) {
    return new Promise((resolve) => rl.question(question, resolve));
}

async function chat(userMessage) {
    const completion = await client.chat.completions.create({
        model: "nvidia/nemotron-3-ultra-550b-a55b",
        messages: [{ role: "user", content: userMessage }],
        temperature: 1,
        top_p: 0.95,
        max_tokens: 16384,
        reasoning_budget: 16384,
        chat_template_kwargs: { enable_thinking: true },
        stream: true,
    });

    process.stdout.write("\nAssistant: ");
    for await (const chunk of completion) {
        const reasoning = chunk.choices[0]?.delta?.reasoning_content;
        if (reasoning) process.stdout.write(reasoning);
        process.stdout.write(chunk.choices[0]?.delta?.content || "");
    }
    process.stdout.write("\n\n");
}

async function main() {
    console.log('NVIDIA LLM chat (type "exit" or "quit" to stop)\n');

    while (true) {
        const input = (await ask("You: ")).trim();
        if (!input) continue;
        if (["exit", "quit", "q"].includes(input.toLowerCase())) break;

        try {
            await chat(input);
        } catch (err) {
            console.error("\nError:", err.message || err, "\n");
        }
    }

    rl.close();
}

main();
