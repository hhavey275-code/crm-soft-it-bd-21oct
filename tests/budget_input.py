import asyncio
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  page=await browser.new_page(viewport={"width":1280,"height":1800})
  await page.goto('http://localhost:8080/auth', wait_until='networkidle')
  await page.evaluate('''async () => {
   const React = await import('/node_modules/.vite/deps/react.js');
   const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
   const {ManagedCreateWizard} = await import('/src/components/ads-manager/ManagedCreateWizard.tsx');
   const host=document.createElement('div'); document.body.append(host);
   ReactDOM.default.createRoot(host).render(React.default.createElement(ManagedCreateWizard,{accounts:[{id:'budget-check',account_id:'act_0',name:'Budget check',kind:'own'}],allPages:[],walletBalance:0,onClose:()=>{},onCreated:()=>{},userId:'budget-regression',draft:{id:'budget-regression',data:{phase:'edit',objective:'TRAFFIC',campaignName:'Budget regression',cAmount:'5.00'}}}));
  }''')
  budget=page.get_by_role('spinbutton').first
  await budget.wait_for()
  await budget.fill('')
  print('Focus after clearing:',await budget.evaluate('(e)=>document.activeElement===e'))
  await page.keyboard.type('25.50')
  assert await budget.input_value() == '25.50'
  assert await budget.evaluate('(e)=>document.activeElement===e')
  await page.get_by_role('button',name='Ad set budget',exact=False).click()
  await page.get_by_role('button',name='Next',exact=True).click()
  budget=page.get_by_role('spinbutton',name='Budget amount (USD)')
  await budget.fill('')
  await page.keyboard.type('12.75')
  assert await budget.input_value() == '12.75'
  assert await budget.evaluate('(e)=>document.activeElement===e')
  await page.get_by_role('button',name='Back',exact=True).click()
  await page.get_by_role('button',name='Campaign budget',exact=False).click()
  assert await page.get_by_role('spinbutton',name='Budget amount (USD)').input_value() == '25.50'
  await page.get_by_role('button',name='Ad set budget',exact=False).click()
  await page.get_by_role('button',name='Next',exact=True).click()
  assert await page.get_by_role('spinbutton',name='Budget amount (USD)').input_value() == '12.75'
  await page.wait_for_function("JSON.parse(localStorage.getItem('myads-drafts-v2:budget-regression') || '[]')[0]?.data.adsets[0].amount === '12.75'")
  saved=await page.evaluate("JSON.parse(localStorage.getItem('myads-drafts-v2:budget-regression'))[0].data")
  assert saved['cAmount'] == '25.50'
  assert saved['adsets'][0]['amount'] == '12.75'
  print('PASS: campaign/ad-set typing, retained focus, navigation, saved amounts')

  await browser.close()
asyncio.run(main())
