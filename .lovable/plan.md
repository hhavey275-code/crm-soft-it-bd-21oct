# External CRM links: keep only Main and Credit Line

## What changes for you

1. **Only two link boxes.** Each ad account's External CRM section gets two boxes: **Main wallet** and **Credit Line wallet**. The Secondary link box goes away.
2. **Top Up buttons on ad accounts:**
   - **Account has an external CRM link:** it shows only **one** Top Up button, for the wallet whose box has the link (Credit Line or Main). It never shows a Secondary button.
   - **Normal account, no external link:** it works as it does now. If the client's Secondary wallet is on, the admin still sees two Top Up buttons (Main and Secondary).
3. **One-time sorting of every external CRM account:**
   - **Credit Line wallet is on:** the link goes in the Credit Line box and the Main box is emptied. The Secondary wallet stays as it is, since it is used for other work.
   - **Secondary wallet is on, Credit Line is off:** Credit Line is turned on with the Secondary rate and due limit, and the link goes in the Credit Line box. Secondary is then turned off and its balance (even if negative) moves to Credit Line.
   - **Only Main is on:** the link goes in the Main box.
4. Each balance move is recorded in both wallets' transaction history as "Secondary → Credit Line shift".

## Clients this affects right now

- **Both wallets stay on, link goes to Credit Line, no balance move:** Kafela Mart, Sajedul Sobuj
- **Link goes to Credit Line (Credit Line already on):** AR RAJU, Shamim Reza, Umor faruk
- **Secondary moves to Credit Line (7):** Anam Hasan, MD AMIN, MD MEHEDI HASAN, Md Rashed Miah, Murtada Bin Al Radhin, primelook, shifa Al Quran
- **Everyone else:** link stays in Main

## Technical details

- One database update for the data changes above. The balance moves use the existing wallet adjust function, so the wallet-to-history check still passes.
- `ExternalTopUpConfigSection`: two inputs (Main and Credit Line), with `external_topup_url_secondary` always saved as null.
- Client and admin ad-account pages: when an account is `external_topup_required`, show only the external button for whichever URL is set and hide the Secondary Top Up. Non-external accounts are unchanged.
- The old Secondary history stays readable. No data is deleted.
