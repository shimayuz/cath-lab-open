const nodes = [...document.querySelectorAll("[data-ja]")];
const english = nodes.map((node) => node.innerHTML);
let locale =
  new URLSearchParams(location.search).get("lang") === "ja" ? "ja" : "en";
const button = document.getElementById("language");
function render() {
  document.documentElement.lang = locale;
  document
    .querySelector("nav")
    .setAttribute(
      "aria-label",
      locale === "ja" ? "メインナビゲーション" : "Main",
    );
  document.title =
    locale === "ja"
      ? "Cath Lab — その手で、心臓への一歩を。"
      : "Cath Lab — Get a feel for the catheter";
  nodes.forEach((node, i) => {
    if (locale === "ja") {
      node.replaceChildren(
        ...node.dataset.ja
          .split("\\n")
          .flatMap((line, j) =>
            j
              ? [document.createElement("br"), document.createTextNode(line)]
              : [document.createTextNode(line)],
          ),
      );
    } else node.innerHTML = english[i];
  });
  button.textContent = locale === "ja" ? "English" : "日本語";
  button.setAttribute(
    "aria-label",
    locale === "ja" ? "Switch to English" : "日本語に切り替える",
  );
}
button.addEventListener("click", () => {
  locale = locale === "en" ? "ja" : "en";
  const url = new URL(location.href);
  url.searchParams.set("lang", locale);
  history.replaceState(null, "", url);
  render();
});
render();
