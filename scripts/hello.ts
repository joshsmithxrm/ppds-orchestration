function greet(name: string): void {
  console.log(`Hello, ${name}! [${Date.now()}]`);
}

const name = process.argv[2] || "orchestration";
greet(name);
