---PAGE 1---

# Machine Learning

Lecture 8

##### Dr. Markus Mühling

Fachbereich Mathematik und Informatik

Philipps-Universität Marburg muehling@informatik.uni-marburg.de

26.11.2024

---PAGE 2---

###### Apart from newly developed slides, the slides in this chapter are an adaptation, combination, or modification of slides of the following persons:

- • Slides of Dominik Heider, University of Marburg, Germany
- • Slides of Andrew Ng, Stanford University, USA


---PAGE 3---

## Linear Regression

---PAGE 4---

##### Review: Scatter Plot

![image 5](<ML_VL_08_Linear_Regression-1-30_images/imageFile5.png>)

---PAGE 5---

#### Review: Pearson's correlation coefficient

1 𝑛

σ𝑖=1𝑛 (𝑥𝑖 − 𝑥)ǉ ∗ (𝑦𝑖 − 𝑦)ǉ 𝑠𝑥 ∗ 𝑠𝑦

𝑠𝑥𝑦 𝑠𝑥 ∗ 𝑠𝑦

𝑟𝑋𝑌 =

=

- • 𝑠𝑋𝑌 : Covariance
- • 𝑟𝑋𝑌 is normalized in the interval [-1,1].
- • If there is a linear dependency between the features, 𝑟𝑋𝑌 is positive or negative


- – 𝑟𝑋𝑌 ≈ 0 : no linear correlation

→ Point cloud shows no direction

- – 1 ≥ 𝑟𝑋𝑌 > 0 : positive correlation

→ Point cloud shows SW-NE direction

- – 0 ≥ 𝑟𝑋𝑌 > −1 : negative correlation


→ Point cloud shows NW-SE direction

---PAGE 6---

##### Linear Regression

###### • Discover relationships between numerical data

– Analyze dependencies between a dependent variable and one or more independent variables

###### • Goal:

– Determine cause-effect relationship

###### • Applications

- – Describing and explaining relations quantitatively
- – Estimate or predict values of dependent variables


---PAGE 7---

##### Simple linear regression

###### Housing Prices (Portland, OR)

- • Assumption: House price depends on the size
- • Price is called the dependent variable
- • Size is the independent variable
- • Is there a model that


Price(in1000sofdollars)

500

| | | | |
|---|---|---|---|
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |


400

300

200

100

0

describes this dependency?

0 1000 2000 3000

Size (feet2)

###### Supervised Learning

###### Regression

the “right answers” are given in the training data

Predict real-valued output

---PAGE 8---

##### Training samples

Housing Prices Datensatz Portland, OR

###### Size in feet2 (x) Price ($) in 1000's (y)

2104 460

1416 232 1534 315

852 178 … …

###### Notation:

m = number of training samples

- x’s = “input” variable / independent variable / feature
- y’s = “output” variable / dependent variable / “target variable” (x(i),y(i)) = i-th training sample


---PAGE 9---

Training set

Learning algorithm

Sizehouseof h Estimatedprice

![image 11](<ML_VL_08_Linear_Regression-1-30_images/imageFile11.png>)

###### Linear regression with one variable Univariate linear regression

---PAGE 10---

- • Dependency is modeled using a regression function ℎ :

with 𝑚 training samples 𝑥 𝑖 ,𝑦 𝑖 and 𝑚 residuals (errors) 𝑒(𝑖).

- • Regression coefficients 𝜃


𝑦(𝑖) = ℎ𝜃 𝑥 𝑖 + 𝑒(𝑖)

![image 13](<ML_VL_08_Linear_Regression-1-30_images/imageFile13.png>)

y

- – 𝜃0 : intercept
- – 𝜃1 : slope


x

---PAGE 11---

Training data

###### Size in feet2 (x) Price ($) in 1000's (y)

2104 460

1416 232 1534 315

852 178 … …

![image 15](<ML_VL_08_Linear_Regression-1-30_images/imageFile15.png>)

Hypothesis: ‘s: Parameters

![image 16](<ML_VL_08_Linear_Regression-1-30_images/imageFile16.png>)

![image 17](<ML_VL_08_Linear_Regression-1-30_images/imageFile17.png>)

How to choose ‘s ?

---PAGE 12---

![image 19](<ML_VL_08_Linear_Regression-1-30_images/imageFile19.png>)

- 0
- 1
- 2
- 3


- 0
- 1
- 2
- 3


- 0
- 1
- 2
- 3


0 1 2 3

0 1 2 3

0 1 2 3

---PAGE 13---

![image 24](<ML_VL_08_Linear_Regression-1-30_images/imageFile24.png>)

- 0
- 1
- 2
- 3


- 0
- 1
- 2
- 3


- 0
- 1
- 2
- 3


| | |
|---|---|
| | |


0 1 2 3

0 1 2 3

0 1 2 3

---PAGE 14---

##### Determination of the regression function

![image 29](<ML_VL_08_Linear_Regression-1-30_images/imageFile29.png>)

Idea:

![image 30](<ML_VL_08_Linear_Regression-1-30_images/imageFile30.png>)

###### Choose so that

![image 31](<ML_VL_08_Linear_Regression-1-30_images/imageFile31.png>)

is close to for the training samples

![image 32](<ML_VL_08_Linear_Regression-1-30_images/imageFile32.png>)

![image 33](<ML_VL_08_Linear_Regression-1-30_images/imageFile33.png>)

---PAGE 15---

##### Method of least squares

![image 35](<ML_VL_08_Linear_Regression-1-30_images/imageFile35.png>)

Choose 𝜃0, 𝜃1

so that σ𝑖 𝑒(𝑖) 2 is minimized.

![image 36](<ML_VL_08_Linear_Regression-1-30_images/imageFile36.png>)

![image 37](<ML_VL_08_Linear_Regression-1-30_images/imageFile37.png>)

---PAGE 16---

#### Cost function: Mean Squared Error

Hypothesis:

![image 39](<ML_VL_08_Linear_Regression-1-30_images/imageFile39.png>)

Parameters:

![image 40](<ML_VL_08_Linear_Regression-1-30_images/imageFile40.png>)

Cost function:

![image 41](<ML_VL_08_Linear_Regression-1-30_images/imageFile41.png>)

Goal:

---PAGE 17---

#### Cost function intuition

Simplified

Hypothesis:

![image 44](<ML_VL_08_Linear_Regression-1-30_images/imageFile44.png>)

![image 45](<ML_VL_08_Linear_Regression-1-30_images/imageFile45.png>)

Parameters:

![image 46](<ML_VL_08_Linear_Regression-1-30_images/imageFile46.png>)

![image 47](<ML_VL_08_Linear_Regression-1-30_images/imageFile47.png>)

Cost function:

![image 48](<ML_VL_08_Linear_Regression-1-30_images/imageFile48.png>)

![image 49](<ML_VL_08_Linear_Regression-1-30_images/imageFile49.png>)

Goal:

![image 50](<ML_VL_08_Linear_Regression-1-30_images/imageFile50.png>)

---PAGE 18---

![image 53](<ML_VL_08_Linear_Regression-1-30_images/imageFile53.png>)

![image 54](<ML_VL_08_Linear_Regression-1-30_images/imageFile54.png>)

![image 55](<ML_VL_08_Linear_Regression-1-30_images/imageFile55.png>)

(for fixed , this is a function of x) (function of the parameter )

- 1
- 2
- 3


![image 56](<ML_VL_08_Linear_Regression-1-30_images/imageFile56.png>)

- 1
- 2
- 3


![image 57](<ML_VL_08_Linear_Regression-1-30_images/imageFile57.png>)

![image 58](<ML_VL_08_Linear_Regression-1-30_images/imageFile58.png>)

y

---PAGE 19---

![image 61](<ML_VL_08_Linear_Regression-1-30_images/imageFile61.png>)

![image 62](<ML_VL_08_Linear_Regression-1-30_images/imageFile62.png>)

###### (for fixed , this is a function of x (function of the parameter )

- 1
- 2
- 3


![image 63](<ML_VL_08_Linear_Regression-1-30_images/imageFile63.png>)

- 1
- 2
- 3


![image 64](<ML_VL_08_Linear_Regression-1-30_images/imageFile64.png>)

![image 65](<ML_VL_08_Linear_Regression-1-30_images/imageFile65.png>)

###### y

---PAGE 20---

![image 68](<ML_VL_08_Linear_Regression-1-30_images/imageFile68.png>)

![image 69](<ML_VL_08_Linear_Regression-1-30_images/imageFile69.png>)

(for fixed , this is a function of x (function of the parameter )

- 1
- 2
- 3


- 1
- 2
- 3


![image 70](<ML_VL_08_Linear_Regression-1-30_images/imageFile70.png>)

![image 71](<ML_VL_08_Linear_Regression-1-30_images/imageFile71.png>)

###### y

= 0,5

![image 72](<ML_VL_08_Linear_Regression-1-30_images/imageFile72.png>)

---PAGE 21---

![image 75](<ML_VL_08_Linear_Regression-1-30_images/imageFile75.png>)

![image 76](<ML_VL_08_Linear_Regression-1-30_images/imageFile76.png>)

(for fixed , this is a function of x (function of the parameter )

- 1
- 2
- 3


- 1
- 2
- 3


![image 77](<ML_VL_08_Linear_Regression-1-30_images/imageFile77.png>)

![image 78](<ML_VL_08_Linear_Regression-1-30_images/imageFile78.png>)

###### y

= 0,5

![image 79](<ML_VL_08_Linear_Regression-1-30_images/imageFile79.png>)

×

---PAGE 22---

![image 82](<ML_VL_08_Linear_Regression-1-30_images/imageFile82.png>)

![image 83](<ML_VL_08_Linear_Regression-1-30_images/imageFile83.png>)

(for fixed , this is a function of x (function of the parameter )

![image 84](<ML_VL_08_Linear_Regression-1-30_images/imageFile84.png>)

- 1
- 2
- 3


- 1
- 2
- 3


= 1,5

![image 85](<ML_VL_08_Linear_Regression-1-30_images/imageFile85.png>)

![image 86](<ML_VL_08_Linear_Regression-1-30_images/imageFile86.png>)

###### y

× ×

---PAGE 23---

![image 89](<ML_VL_08_Linear_Regression-1-30_images/imageFile89.png>)

![image 90](<ML_VL_08_Linear_Regression-1-30_images/imageFile90.png>)

###### (for fixed , this is a function of x (function of the parameter )

- 1
- 2
- 3


- 1
- 2
- 3


![image 91](<ML_VL_08_Linear_Regression-1-30_images/imageFile91.png>)

###### y

---PAGE 24---

![image 95](<ML_VL_08_Linear_Regression-1-30_images/imageFile95.png>)

![image 96](<ML_VL_08_Linear_Regression-1-30_images/imageFile96.png>)

(for fixed , this is a function of x (function of the parameter )

- 1
- 2
- 3


- 1
- 2
- 3


× ×

![image 97](<ML_VL_08_Linear_Regression-1-30_images/imageFile97.png>)

###### y

---PAGE 25---

Summary

Hypothesis:

![image 101](<ML_VL_08_Linear_Regression-1-30_images/imageFile101.png>)

![image 102](<ML_VL_08_Linear_Regression-1-30_images/imageFile102.png>)

Parameters:

![image 103](<ML_VL_08_Linear_Regression-1-30_images/imageFile103.png>)

Cost function:

![image 104](<ML_VL_08_Linear_Regression-1-30_images/imageFile104.png>)

Goal:

---PAGE 26---

##### Univariate Lineare Regression

![image 106](<ML_VL_08_Linear_Regression-1-30_images/imageFile106.png>)

![image 107](<ML_VL_08_Linear_Regression-1-30_images/imageFile107.png>)

![image 108](<ML_VL_08_Linear_Regression-1-30_images/imageFile108.png>)

(for fixed , this is a function of x) (function of the parameters )

![image 109](<ML_VL_08_Linear_Regression-1-30_images/imageFile109.png>)

![image 110](<ML_VL_08_Linear_Regression-1-30_images/imageFile110.png>)

![image 111](<ML_VL_08_Linear_Regression-1-30_images/imageFile111.png>)

---PAGE 27---

![image 113](<ML_VL_08_Linear_Regression-1-30_images/imageFile113.png>)

![image 114](<ML_VL_08_Linear_Regression-1-30_images/imageFile114.png>)

![image 115](<ML_VL_08_Linear_Regression-1-30_images/imageFile115.png>)

###### (for fixed , this is a function of x) (function of the parameters )

![image 116](<ML_VL_08_Linear_Regression-1-30_images/imageFile116.png>)

![image 117](<ML_VL_08_Linear_Regression-1-30_images/imageFile117.png>)

![image 118](<ML_VL_08_Linear_Regression-1-30_images/imageFile118.png>)

---PAGE 28---

### How do we find the parameters (best ) that minimize the cost function?

---PAGE 29---

How do we find the parameters (best ) that minimize the cost function?

➔OPTIMIZATION

---PAGE 30---

##### Idea: Gradient Descent

![image 122](<ML_VL_08_Linear_Regression-1-30_images/imageFile122.png>)

![image 123](<ML_VL_08_Linear_Regression-1-30_images/imageFile123.png>)

