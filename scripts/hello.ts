function greet(name: string): void {
  console.log(`Hello, ${name}! [${Date.now()}]`);
}

function main(): void {
  const name = process.argv[2] || "orchestration";
  greet(name);
}

main();
