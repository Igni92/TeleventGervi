/**
 * Cible de portage des popups flottants (menus, comboboxes, sélecteurs de lot).
 *
 * Ces popups sont portés hors de leur parent pour échapper aux `overflow` et aux
 * contextes d'empilement. Les porter dans `<body>` a toutefois un effet de bord
 * quand ils s'ouvrent AU-DESSUS d'un Dialog Radix modal : le piège à focus du
 * Dialog (FocusScope) écoute `focusin` sur `document` et, dès que le focus
 * atterrit sur un nœud qui n'est pas DANS son conteneur, il le rapatrie de force
 * (@radix-ui/react-focus-scope : `container.contains(target)` sinon
 * `focus(lastFocusedElement)`).
 *
 * Conséquence observée en production : dans le sélecteur de lot, les OPTIONS
 * fonctionnaient (un bouton déclenche son `onClick` même s'il perd le focus)
 * mais le CHAMP « saisir le n° d'entrée » était inutilisable — on cliquait, le
 * focus repartait aussitôt, impossible de taper. Ni `pointer-events-auto` ni les
 * garde-fous `onFocusOutside` n'y changent quoi que ce soit : ils empêchent la
 * FERMETURE du panneau, pas le vol de focus.
 *
 * On porte donc le popup DANS le Dialog quand il y en a un : le focus est alors
 * légitimement « à l'intérieur », le piège se tait, et les clics n'ont plus
 * besoin d'échapper au `pointer-events:none` du body. Les coordonnées ne bougent
 * pas : le contenu d'un Dialog est `position: fixed; inset: 0`, donc son bloc
 * conteneur est le viewport — exactement la référence qu'utilisaient déjà les
 * popups en `position: fixed`.
 *
 * Hors Dialog, on retombe sur `<body>` (comportement d'origine).
 */
export function floatingPortalTarget(anchor: Element | null | undefined): HTMLElement {
  const dialog = anchor?.closest?.('[role="dialog"]');
  if (dialog) return dialog as HTMLElement;

  // Sans élément d'ancrage (popup ouvert depuis un menu contextuel, positionné
  // par coordonnées), on retombe sur le Dialog ouvert le PLUS RÉCENT. Radix
  // ajoute chaque portail à la fin de <body>, donc le dernier de l'ordre DOM est
  // le plus récemment ouvert — c'est-à-dire celui d'où vient l'interaction.
  // Heuristique assumée : elle ne tomberait à côté qu'avec deux dialogs ouverts
  // dont le plus ancien serait au premier plan, ce qui n'arrive pas ici.
  const open = document.querySelectorAll('[role="dialog"][data-state="open"]');
  if (open.length > 0) return open[open.length - 1] as HTMLElement;

  return document.body;
}
