<?php
require __DIR__.'/preflight.php';
$n=0;
function check($ok,$msg){global $n;++$n;if(!$ok)throw new Exception($msg);}
$cases=array(
 array('{}',1,0),array('[]',1,0),array('{"a":[]}',2,1),
 array('[0,true,false,null,-1.2e+3]',1,5),
 array(json_encode(array('title'=>'[[{{,:', 'escaped'=>'\\"[{]}\\\\"','arr'=>array(0,'"'))),2,7)
);
foreach($cases as $case){$r=preflight_budget($case[0]);check($r['ok']&&$r['containers']===$case[1]&&$r['tokens']===$case[2],'count '. $case[0]);}
check(preflight_budget('[[],{}]',3,0)['ok'],'exact container boundary');
check(!preflight_budget('[[],{}]',2,0)['ok'],'container +1 rejected');
check(preflight_budget('[0,1,"x"]',1,3)['ok'],'exact token boundary');
check(!preflight_budget('[0,1,"x"]',1,2)['ok'],'token +1 rejected');
foreach(array('[','[1,]','{"x":}', '["unterminated') as $bad){$r=preflight_budget($bad);json_decode($bad,false,16);check(!$r['ok'] || json_last_error()!==JSON_ERROR_NONE,'invalid JSON rejected by final decoder');}
echo "OK: $n scanner assertions passed.\n";
