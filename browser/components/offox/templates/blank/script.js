// Counts visits in a file inside this site's folder.
(async () => {
  let button = document.getElementById("count");
  let visits = Number(await Offox.readText("visits.txt", "0")) + 1;
  await Offox.writeText("visits.txt", String(visits));
  button.textContent = `You have visited ${visits} time${visits === 1 ? "" : "s"}`;
  button.onclick = async () => {
    await Offox.writeText("visits.txt", "0");
    button.textContent = "Counter reset";
  };
})();
