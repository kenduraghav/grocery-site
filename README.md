# Grocery Store (static site)

Plain HTML + CSS + JavaScript. No build step, no framework, no server.

## Files

    index.html          the page
    css/styles.css      the look
    js/app.js           catalog, cart, WhatsApp bill
    data/config.json    shop name, WhatsApp number, currency symbol
    data/products.json  every item you sell

## 1. First setup (2 minutes)

Open `data/config.json` and change:

- `shopName`: shown at the top and in the bill
- `whatsappNumber`: country code + number, digits only, no `+` or spaces (India example: `919876543210`)
- `currencySymbol`: for example `₹`

## 2. Run it on your computer

Opening `index.html` by double-click will NOT work (browsers block loading JSON from files). Use a tiny local server instead:

    python3 -m http.server 8000      # then open http://localhost:8000

(or `npx serve`, or the "Live Server" extension in VS Code)

## 3. Edit products

One item = one block in `data/products.json`. To add an item, copy a block, paste it, change the values:

    { "id": "chilli-aachi-100g", "name": "Chilli Powder", "brand": "Aachi",
      "category": "Masala", "unit": "100 g", "price": 4500, "inStock": true },

| Field | Rule |
|---|---|
| `id` | unique, never reused, never changed. Letters, numbers, hyphens. |
| `name` | the plain item name, same for every brand ("Chilli Powder") |
| `brand` | optional. Spell it the same way everywhere. Leave the line out for loose items (vegetables). |
| `category` | becomes a filter button automatically |
| `unit` | optional pack size, for example `1 kg` |
| `price` | whole number in paise/cents: 45.00 is `4500`. Never use a decimal point. |
| `inStock` | `true` or `false`. `false` shows "Out of stock" and blocks ordering. |

Same item in a different brand or size = another block with its own `id`.

JSON rules that trip people up: a comma after every block except the last one in the list, double quotes only, no comments.

## 4. Check your edits

Open the site with `?check` at the end (for example `https://your-site/?check`). Any block with a problem (duplicate id, price with a decimal, missing name) is listed in a yellow box and left out of the shop. Customers never see this box.

If the whole JSON file is broken (for example a missing comma), customers see "The item list couldn't load", and `?check` shows the technical reason. Fix the file and refresh.

## 5. Put it online (free)

- **GitHub Pages:** push this folder to a repo, then Settings > Pages > deploy from the main branch.
- **Netlify / Cloudflare Pages:** drag the folder into the dashboard.

After that, updating the shop = edit `data/products.json` and push/upload. Customers get the new data on their next page load.

## How the order works

The customer fills their name (and optional address/note), taps "Send order on WhatsApp", and WhatsApp opens with the bill typed in. They must press Send. The site cannot confirm that a message was sent, and there is no online payment: confirm the total with the customer in the chat.

Very long orders (about 40+ lines) are copied to the clipboard instead, with a prompt to paste them into the chat.
