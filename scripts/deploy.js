async function main() {

  const EventTicket = await ethers.getContractFactory("EventTicket");

  const eventTicket = await EventTicket.deploy();

  await eventTicket.waitForDeployment();

  console.log("EventTicket deployed to:", await eventTicket.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});