<?php
/** Native PHP 7.4+ CLI only. Usage: php -d memory_limit=128M run.php REPO_ROOT RESULTS_DIR */
if (PHP_SAPI!=='cli') throw new RuntimeException('CLI required.');
$root=realpath($argv[1] ?? dirname(__DIR__,2));
$out=$argv[2] ?? sys_get_temp_dir().'/cast-budget-results';
if (!$root || !is_file($root.'/includes/uploads.php')) throw new RuntimeException('Supply plugin checkout root.');
if (!is_dir($out) && !mkdir($out,0700,true)) throw new RuntimeException('Cannot create output directory.');
$out=realpath($out);$temp=sys_get_temp_dir().'/cast-budget-'.bin2hex(random_bytes(8));mkdir($temp,0700);
$report=array('php'=>PHP_VERSION,'sapi'=>PHP_SAPI,'memory_limit'=>'128M','timeout_seconds'=>20,'budget'=>array('containers'=>100016,'tokens'=>400000,'depth'=>15),'measurements'=>array(),'checks'=>array(),'errors'=>array());
function run_child($args,$label) {
 global $out;
 $stdout=$out.'/'.$label.'.stdout';$stderr=$out.'/'.$label.'.stderr';
 $command=array_merge(array(PHP_BINARY,'-d','memory_limit=128M','-d','display_errors=stderr','-d','log_errors=0'),$args);
 $process=proc_open($command,array(0=>array('file','/dev/null','r'),1=>array('file',$stdout,'w'),2=>array('file',$stderr,'w')),$pipes);
 if (!is_resource($process)) throw new RuntimeException('Cannot start '.$label);
 $deadline=microtime(true)+20;$timed_out=false;
 do {$status=proc_get_status($process);if(!$status['running'])break;if(microtime(true)>$deadline){$timed_out=true;proc_terminate($process,9);break;}usleep(10000);}while(true);
 $closed=proc_close($process);$exit=$status['exitcode']>=0?$status['exitcode']:$closed;
 $record=array('label'=>$label,'exit_code'=>$exit,'timed_out'=>$timed_out,'stdout_file'=>basename($stdout),'stderr_file'=>basename($stderr));
 if($timed_out || $exit!==0)throw new RuntimeException($label.' failed: '.json_encode($record).' '.file_get_contents($stderr));
 return array($record,file_get_contents($stdout));
}
function check($condition,$label){global $report;$report['checks'][]=array('label'=>$label,'passed'=>(bool)$condition);if(!$condition)$report['errors'][]=$label;}
function copy_tree($src,$dst){if(is_dir($src)){if(!is_dir($dst))mkdir($dst,0700,true);foreach(scandir($src) as $name)if($name!=='.'&&$name!=='..')copy_tree($src.'/'.$name,$dst.'/'.$name);}else{if(!is_dir(dirname($dst)))mkdir(dirname($dst),0700,true);if(!copy($src,$dst))throw new RuntimeException('Copy failed: '.$src);}}
function clean_tree($dir){foreach(scandir($dir) as $name){if($name==='.'||$name==='..')continue;$p=$dir.'/'.$name;if(is_dir($p))clean_tree($p);else unlink($p);}rmdir($dir);}
try {
 $base="{\n\"version\":1,\"width\":80,\"height\":24,\"stdout\":[[0,\"ok\"]],\"metadata\":";
 $fixtures=array(
 'normal-fixture'=>file_get_contents($root.'/tests/fixtures/v1-pretty.cast'),
 'normal-100k-frames'=>"{\n\"version\":1,\"width\":80,\"height\":24,\"stdout\":[".str_repeat('[0,""],',99999).'[0,""]]}',
 'escaped-strings'=>json_encode(array('version'=>1,'width'=>80,'height'=>24,'stdout'=>array(array(0,'\\"[{]}\\\\" ,: true false null')),'metadata'=>str_repeat('[{},',120000))),
 'wide-empty-objects'=>$base.'['.str_repeat('{},',259999).'{}]}',
 'wide-scalars'=>$base.'['.str_repeat('0,',799999).'0]}'
 );
 $properties=array();for($i=0;$i<120000;++$i)$properties[]='"k'.$i.'":0';$fixtures['wide-properties']=$base.'{'.implode(',',$properties).'}}';unset($properties);
 foreach($fixtures as $name=>$contents){if(strlen($contents)>2097152)throw new RuntimeException('Fixture exceeds 2 MiB');file_put_contents($temp.'/'.$name.'.cast',$contents);}
 unset($fixtures,$contents);
 foreach(array('normal-fixture','normal-100k-frames','escaped-strings','wide-empty-objects','wide-scalars','wide-properties') as $name){
  $pair=array();foreach(array('baseline','gated') as $mode){list($process,$text)=run_child(array(__DIR__.'/measure.php',$root,$temp.'/'.$name.'.cast',$mode),$name.'-'.$mode);$result=json_decode($text,true,512,JSON_THROW_ON_ERROR);$pair[$mode]=$result;check($result['sapi']==='cli' && $result['memory_limit']==='128M',$name.' '.$mode.' native CLI and memory limit');$report['measurements'][]=array('fixture'=>$name,'process'=>$process,'result'=>$result);}
  check($pair['baseline']['valid']===true,$name.' baseline accepted');
  $reject=in_array($name,array('wide-empty-objects','wide-scalars'),true);
  check($pair['gated']['valid']===!$reject,$name.' expected gated validity');
  check($pair['gated']['decoded']===!$reject,$name.' expected decode reached/skipped');
  if($reject){check($pair['gated']['peak_bytes']<$pair['baseline']['peak_bytes']*0.5,$name.' tracked peak reduced by >50%');$expected=$name==='wide-empty-objects'?300105:800049;check($pair['gated']['gate']['offset']===$expected,$name.' expected rejection offset');}
 }
 list($process,$text)=run_child(array(__DIR__.'/scanner-tests.php'),'scanner-tests');check(strpos($text,'13 scanner assertions passed.')!==false,'13 scanner assertions');$report['scanner_process']=$process;
 $copy=$temp.'/plugin';mkdir($copy);foreach(array('asciicast-player.php','includes','tests/php','tests/fixtures') as $item)copy_tree($root.'/'.$item,$copy.'/'.$item);
 foreach(array('index.asset.php','view.asset.php','runtime.asset.php') as $item)if(is_file($root.'/build/'.$item))copy_tree($root.'/build/'.$item,$copy.'/build/'.$item);
 $expected_assertions=is_file($root.'/build/runtime.asset.php')?233:229;
 $report['expected_suite_assertions']=$expected_assertions;
 foreach(array('baseline','gated') as $mode){
  if($mode==='gated'){$source=file_get_contents($copy.'/includes/uploads.php');$needle='function is_cast_v1( $text ) {';if(substr_count($source,$needle)!==1)throw new RuntimeException('Injection marker missing/ambiguous.');$source=str_replace($needle,$needle."\n if (!\\preflight_budget(\$text)['ok']) return false;",$source);file_put_contents($copy.'/includes/uploads.php',$source);}
  $wrapper=$temp.'/suite-'.$mode.'.php';file_put_contents($wrapper,"<?php require ".var_export(__DIR__.'/preflight.php',true).'; require '.var_export($copy.'/tests/php/run.php',true).';');
  list($process,$text)=run_child(array($wrapper),'suite-'.$mode);preg_match('/OK: ([0-9]+) assertions passed\./',$text,$match);$count=isset($match[1])?(int)$match[1]:0;check($count===$expected_assertions,'existing '.$expected_assertions.' assertions '.$mode);$report['suite_assertion_counts'][$mode]=$count;$report['suite_processes'][$mode]=$process;
 }
 check($report['suite_assertion_counts']['baseline']===$report['suite_assertion_counts']['gated'],'baseline and gated suite counts equal');
} catch(Throwable $error){$report['errors'][]=$error->getMessage();}
$report['passed']=count($report['errors'])===0;
file_put_contents($out.'/results.json',json_encode($report,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n");
echo json_encode(array('passed'=>$report['passed'],'php'=>PHP_VERSION,'measurements'=>count($report['measurements']),'checks'=>count($report['checks']),'errors'=>$report['errors'],'results'=>$out.'/results.json'),JSON_THROW_ON_ERROR)."\n";
clean_tree($temp);exit($report['passed']?0:1);
