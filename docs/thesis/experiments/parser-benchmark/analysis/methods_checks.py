"""Methods checks on the benchmark votes (review pass (c), 2026-11-10).

Same Bradley-Terry fit, prior and vote bootstrap as the benchmark's ranking;
adds a page-level bootstrap, decision times, side preference, a refit without
"both unusable" votes, seed stability and head-to-head counts.
Run: python3 methods_checks.py [resamples]   (about a minute at 1000)
"""
import json, math, random, collections, statistics, sys, pathlib
from math import comb
base=str(pathlib.Path(__file__).resolve().parent.parent / 'runs')+'/'
cmps=['cmp-2026-10-30_8825','cmp-2026-10-31_04de','cmp-2026-10-31_0f86','cmp-2026-11-01_0010']
votes=[]
for c in cmps:
    meta=json.load(open(base+c+'/compare.json'))
    act={}
    for l in open(base+c+'/votes.jsonl'):
        if not l.strip(): continue
        v=json.loads(l)
        if v['type']=='vote': act[v['duel']]=v
        elif v['type']=='retract': act.pop(v['duel'],None)
    by={d['duel']:d for d in meta['schedule']}
    for k in sorted(act):
        v=dict(act[k]); v['round']=by[k]['round']; v['cmp']=c; v['ptype']=by[k]['type']; votes.append(v)
ents=sorted({v['left'] for v in votes}|{v['right'] for v in votes})
def outs(vs):
    o=[]
    for v in vs:
        a,b=v['left'],v['right']; ch=v['choice']
        s=1.0 if ch=='left' else 0.0 if ch=='right' else 0.5
        o.append((a,b,s))
    return o
def fit(o):
    n=len(ents); idx={e:i for i,e in enumerate(ents)}; share=1.0/(n-1)
    wins=[0.5]*n; games=[[0.0 if i==j else share for j in range(n)] for i in range(n)]
    for a,b,s in o:
        i,j=idx[a],idx[b]; wins[i]+=s; wins[j]+=1-s; games[i][j]+=1; games[j][i]+=1
    p=[1.0]*n
    for _ in range(5000):
        new=[wins[i]/sum(games[i][j]/(p[i]+p[j]) for j in range(n) if j!=i) for i in range(n)]
        m=math.exp(sum(math.log(x) for x in new)/n); new=[x/m for x in new]
        ch=max(abs(math.log(a/b)) for a,b in zip(new,p)); p=new
        if ch<1e-7: break
    s=dict(zip(ents,p)); return {e:1000+400*math.log10(s[e]/s['current']) for e in ents}
def q(vals,p):
    o=sorted(vals); k=(len(o)-1)*p; lo,hi=math.floor(k),math.ceil(k); return o[lo]+(o[hi]-o[lo])*(k-lo)
pt=fit(outs(votes))
print('n votes',len(votes)); print('points', {e:round(pt[e],1) for e in sorted(pt,key=lambda e:-pt[e])})
K=10; B=int(sys.argv[1]) if len(sys.argv)>1 else 1000
rng=random.Random(20261103)
vb=collections.defaultdict(list)
for _ in range(B):
    r=fit(outs([votes[rng.randrange(len(votes))] for _ in votes]))
    for e in ents: vb[e].append(r[e])
pages=sorted({v['page'] for v in votes}); byp=collections.defaultdict(list)
for v in votes: byp[v['page']].append(v)
rng=random.Random(20261110); pb=collections.defaultdict(list)
for _ in range(B):
    vs=[]
    for _ in pages: vs+=byp[pages[rng.randrange(len(pages))]]
    r=fit(outs(vs))
    for e in ents: pb[e].append(r[e])
print(f'\nB={B}; one-sided Bonferroni k={K}: lower = {2.5/K}th percentile')
print(f"{'method':18s} {'pts':>6s} | vote-boot: 95%lo  hi  bonf | page-boot: 95%lo  hi  bonf")
for e in sorted(ents,key=lambda e:-pt[e]):
    if e=='current': continue
    print(f"{e:18s} {pt[e]:6.0f} | {q(vb[e],.025):7.0f} {q(vb[e],.975):5.0f} {q(vb[e],.0025):5.0f} | {q(pb[e],.025):7.0f} {q(pb[e],.975):5.0f} {q(pb[e],.0025):5.0f}")
# side and speed
dec=[v for v in votes if v['choice'] in('left','right')]
print('\nchoices',collections.Counter(v['choice'] for v in votes))
print('decisive',len(dec),'left share',round(sum(v['choice']=='left' for v in dec)/len(dec),3))
secs=[v['seconds'] for v in votes if v.get('seconds') is not None]
print('seconds median',statistics.median(secs),'share<5s',round(sum(s<5 for s in secs)/len(secs),3),'share<3s',round(sum(s<3 for s in secs)/len(secs),3))
print('votes per page min/median/max', min(len(x) for x in byp.values()), statistics.median(len(x) for x in byp.values()), max(len(x) for x in byp.values()))

# --- side preference, times by choice, refit without both_bad, seed stability
# exact binomial for side bias
n=141;k=55
p=sum(comb(n,i) for i in range(0,k+1))/2**n*2
print('side bias two-sided p',round(p,4))
# seconds by choice
by=collections.defaultdict(list)
for v in votes: by[v['choice']].append(v['seconds'])
for c,s in by.items(): print(c,len(s),'median s',round(statistics.median(s),1),'<5s',sum(x<5 for x in s))
# per comparison medians and fast share
for c in cmps:
    s=[v['seconds'] for v in votes if v['cmp']==c]; print(c,len(s),round(statistics.median(s),1),sum(x<5 for x in s))
# sensitivity: drop both_bad
nb=[v for v in votes if v['choice']!='both_bad']
p2=fit(outs(nb)); print('\nwithout both_bad (n=%d):'%len(nb), {e:round(p2[e]) for e in sorted(p2,key=lambda e:-p2[e])})
# vote-bootstrap stability of Bonferroni bounds across seeds (B=1000)
for seed in (1,2,3):
    rng=random.Random(seed); vb=collections.defaultdict(list)
    for _ in range(1000):
        r=fit(outs([votes[rng.randrange(len(votes))] for _ in votes]))
        for e in ents: vb[e].append(r[e])
    print('seed',seed,{e:round(q(vb[e],.0025)) for e in ('pymupdf4llm','mineru','opendataloader','docling','marker')})

# --- the anchor's both-unusable verdicts in the first comparison; order effect
c1=[v for v in votes if v['cmp']=='cmp-2026-10-30_8825' and 'current' in (v['left'],v['right'])]
bb=[v for v in c1 if v['choice']=='both_bad']
print('current in cmp1:',len(c1),'both_bad',len(bb),'of which <5s',sum(v['seconds']<5 for v in bb),'<10s',sum(v['seconds']<10 for v in bb),'median',statistics.median(v['seconds'] for v in bb))
# order effect: first vs last third of cmp1 both_bad share
c=[v for v in votes if v['cmp']=='cmp-2026-10-30_8825']; c.sort(key=lambda v:v['at'])
t=len(c)//3
for i,part in enumerate((c[:t],c[t:2*t],c[2*t:])): print('third',i+1,'both_bad share',round(sum(v['choice']=='both_bad' for v in part)/len(part),2),'median s',statistics.median(v['seconds'] for v in part))
print('first vote at',min(v['at'] for v in votes))

# --- head-to-head against the anchor
for m in ('pymupdf4llm','ai_vision_strong','ai_vision','mineru','opendataloader'):
    c=collections.Counter()
    for v in votes:
        if {v['left'],v['right']}=={m,'current'}:
            ch=v['choice']
            if ch in('left','right'): c['win' if v[ch]==m else 'loss']+=1
            else: c[ch]+=1
    print(m,'vs current:',dict(c))
