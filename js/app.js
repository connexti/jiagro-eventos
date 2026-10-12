// Entry point: registers every category module with the core shell.
// Adding a new category (e.g. "inventory stock") is just a new file
// under js/categories/ plus one more entry in this array.
import { init } from "./core.js";
import partyInventory from "./categories/party-inventory.js";
import inventoryStock from "./categories/inventory-stock.js";

init([partyInventory, inventoryStock]);
