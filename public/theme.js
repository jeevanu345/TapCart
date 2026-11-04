// Runs before first paint so a stored dark theme never flashes white.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem("tapcart.theme");
  } catch (e) {}
  if (theme !== "light" && theme !== "dark")
    theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
})();
