import {describe,expect,it} from "vitest";
import {formatMoney,moneyInput,parseMoney,walletCurrency} from "../src/lib/currency";
describe("money in minor units",()=>{
  it("treats existing wallets as VND",()=>{expect(walletCurrency()).toBe("VND");expect(walletCurrency("USD")).toBe("USD");});
  it("parses USD decimal amounts precisely to cents",()=>{expect(parseMoney("0.29","USD")).toBe(29);expect(parseMoney("12,3","USD")).toBe(1230);expect(parseMoney("100","USD")).toBe(10000);expect(parseMoney("0.001","USD")).toBeNull();});
  it("requires whole VND and safe integer amounts",()=>{expect(parseMoney("100000","VND")).toBe(100000);expect(parseMoney("100.5","VND")).toBeNull();expect(parseMoney("9007199254740992","VND")).toBeNull();expect(parseMoney("-1","USD")).toBeNull();});
  it("formats amounts without floating-point aggregation",()=>{expect(formatMoney(123456,"USD")).toBe("$1,234.56");expect(formatMoney(-29,"USD")).toBe("-$0.29");expect(formatMoney(1000000,"VND")).toBe("1.000.000\u00a0₫");expect(moneyInput(29,"USD")).toBe("0.29");});
});
