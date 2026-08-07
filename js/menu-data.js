export const fallbackProducts = [
  {id:'seblak-all',name:'Seblak All Varian',category:'Seblak',barcode:'',cost:5000,price:8000,wholesalePrice:7500,resellerPrice:7000,stock:50,minStock:10,unit:'porsi',branchIds:['aya-seblak-angkringan']},
  {id:'paket-seblak-es-teh',name:'Paket Seblak + Es Teh',category:'Paket',cost:6500,price:10000,wholesalePrice:9500,resellerPrice:9000,stock:40,minStock:8,unit:'paket',branchIds:['aya-seblak-angkringan'],bundle:[{productId:'seblak-all',qty:1},{productId:'es-teh',qty:1}]},
  {id:'gado-gado',name:'Gado-Gado',category:'Makanan',cost:7500,price:12000,stock:30,minStock:5,unit:'porsi',branchIds:['aya-seblak-angkringan']},
  {id:'siomay-telur',name:'Siomay Telur',category:'Makanan',cost:6000,price:10000,stock:30,minStock:5,unit:'porsi',branchIds:['aya-seblak-angkringan']},
  {id:'sego-sambel-ayam',name:'Sego Sambel Ayam',category:'Makanan',cost:8000,price:12000,stock:30,minStock:5,unit:'porsi',branchIds:['aya-seblak-angkringan']},
  {id:'nasi-kucing',name:'Nasi Kucing',category:'Angkringan',cost:3000,price:5000,stock:40,minStock:8,unit:'bungkus',branchIds:['aya-seblak-angkringan']},
  {id:'sate-rempelo',name:'Sate Rempelo Ati',category:'Bakaran',cost:1800,price:3000,stock:40,minStock:10,unit:'tusuk',branchIds:['aya-seblak-angkringan']},
  {id:'es-teh',name:'Es Teh',category:'Minuman Dingin',cost:1500,price:4000,stock:100,minStock:20,unit:'gelas',branchIds:['aya-seblak-angkringan']},
  {id:'kopi-hitam',name:'Kopi Hitam Racik',category:'Minuman Panas',cost:2000,price:5000,stock:60,minStock:10,unit:'cangkir',branchIds:['aya-seblak-angkringan']},
  {id:'beras-5kg',name:'Beras Premium 5 Kg',category:'Sembako',barcode:'899000000001',cost:68000,price:75000,wholesalePrice:73000,resellerPrice:72000,stock:20,minStock:5,unit:'sak',branchIds:['dapur-aya-sembako']},
  {id:'minyak-1l',name:'Minyak Goreng 1 Liter',category:'Sembako',barcode:'899000000002',cost:17000,price:19000,wholesalePrice:18500,resellerPrice:18000,stock:40,minStock:10,unit:'pouch',branchIds:['dapur-aya-sembako']}
];
export const fallbackBranches = [
  {id:'dapur-aya-sembako',name:'DAPUR AYA SEMBAKO',code:'DAS',address:'Prambon, Nganjuk',phone:'',active:true},
  {id:'aya-seblak-angkringan',name:'AYA SEBLAK DAN ANGKRINGAN',code:'ASA',address:'Samping Alfamart Prambon',phone:'085136798499',active:true}
];
