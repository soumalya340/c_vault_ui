Is Swap is exectued 
Inside Vaults Ops section + Vaults section functioning
1. Vault  is fetched through vault id 
2. Each asset is fetched in asset wise , because it's an array , max 5 assets , it will iterate upto but though there is num_assets fields insde  vault struct so fetching and looping throug each set , saving in an temp variable. (All inside Vault ops )
3. check supabase already asset info pool id and pyth id is already exists or not for sol or that eligible base mint from which the vault is being created. 
4. If Pool is not created you can not  put pool manually,
5.  if pyth id is not  there we can put it manually 

Inside Vaults Sections 
6. During vault creating time use Alt address , that address will be stored inside
7. When people depoist , or reedeem the alt shall be used swap usdc or any eligible mint 
8. The button of deposit should be deposit and redeem button should be reedem and claim , because we will not store user info in table 
9. The user deposit we will not check anything , redeem&claim time we will do onchain check that if the user is have tokens to burn or set to take there claim . 





Note:- 
1. Every table details is in Supabase  Info
2. We are using Alt as bundling is not possible in devnet 
3. Using eligible base mint array in global state cause sometimes mock usdc is needed to test or usdt is needed .