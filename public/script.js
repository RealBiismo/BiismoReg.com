async function checkVehicle() {
  const reg = document.getElementById("regInput").value;

  const res = await fetch("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationNumber: reg })
  });

  const data = await res.json();
  console.log(data);

  // TODO: Build your result UI here
}
