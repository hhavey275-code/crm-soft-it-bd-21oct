# External CRM links: keep only Main and Credit Line

## What changes for you

1. **Only two link boxes.** Each ad account's External CRM section gets two boxes: **Main wallet** and **Credit Line wallet**. The Secondary box goes away, and so does the Secondary external Top Up button.
2. **One-time sorting of every external CRM account** (based on the client's wallets):
   - **Credit Line wallet is on:** the link goes in the Credit Line box and the Main box is emptied.
   - **Secondary wallet is on, Credit Line is off:** Secondary is turned off and Credit Line is turned on. The Secondary rate and due limit are copied to Credit Line, the Secondary balance (even if negative) moves to Credit Line, and the link goes in the Credit Line box.
   - **Only Main is on:** the link goes in the Main box.
3. **Clients with both Secondary and Credit Line on** (Kafela Mart, Sajedul Sobuj): the Secondary balance is added to Credit Line and Secondary is turned off. Credit Line keeps its own rate (৳132).
4. Each balance move is recorded in both wallets' transaction history as "Secondary → Credit Line shift", so the numbers can always be traced.

## Clients this affects right now

- **Secondary moves to Credit Line (9):** Anam Hasan, MD AMIN, MD MEHEDI HASAN, Md Rashed Miah, Murtada Bin Al Radhin, primelook, shifa Al Quran, Kafela Mart (-10,230.27), Sajedul Sobuj (-3,349.79)
- **Link goes to Credit Line (already on):** AR RAJU, Shamim Reza, Umor faruk, plus the 2 above
- **Everyone else:** link stays in Main

## Technical details

- One database update for the data changes above. Each client is handled inside one transaction. The balance moves use the existing wallet adjust function, so the wallet-to-history check still passes.
- `ExternalTopUpConfigSection`: two inputs (Main and Credit Line), with `external_topup_url_secondary` always saved as null.
- The client and admin ad-account pages stop showing the Secondary external Top Up button. The CRM helper keeps working because `primary` and `credit_line` are still accepted.
- The old Secondary history stays readable. No data is deleted.
